import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
process.env.AGENT_GAMES_HMAC_SECRET = "test-secret";
delete process.env.KURIER_API_KEY;
const { createAgentServer } = await import("./server.mjs");
const { decide, parseZkReceipt } = await import("./policy.mjs");

const sign = (body) => createHmac("sha256", "test-secret").update(body).digest("hex");
async function start(t) {
  const server = createAgentServer().listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function call(base, payload, signature) {
  const raw = JSON.stringify(payload);
  const response = await fetch(`${base}/api/agent`, { method: "POST", headers: { "content-type": "application/json", "x-agent-games-signature": signature ?? sign(raw) }, body: raw });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}
// Well-formed but cryptographically meaningless Groth16 proof (shape only).
const shapedReceipt = {
  proof: { pi_a: ["1", "2", "1"], pi_b: [["1", "2"], ["3", "4"], ["1", "0"]], pi_c: ["5", "6", "1"], protocol: "groth16", curve: "bn128" },
  public_signals: ["123456789"]
};

test("responds to a signed preflight", async (t) => {
  const base = await start(t);
  const result = await call(base, { type: "agent-games.preflight.v1", agent_id: "agt_test", nonce: "n" });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { ok: true, protocolVersion: "v1" });
  assert.equal(result.response.headers.get("x-agent-games-signature"), sign(result.text));
});

test("fails closed on unsigned or malformed signatures", async (t) => {
  const base = await start(t);
  assert.equal((await call(base, { task_id: "bad", input: {} }, "wrong")).response.status, 401);
  assert.equal((await call(base, { task_id: "bad2", input: {} }, "zz".repeat(32))).response.status, 401);
});

test("evaluates a signed policy task", async (t) => {
  const base = await start(t);
  const result = await call(base, { task_id: "policy-1", input: { policy: { rules: [{ id: "budget", field: "budget", operator: "lte", value: 5000 }] }, application: { budget: 4200 } } });
  assert.equal(result.body.decision, "APPROVE");
});

test("signs NLnet amount decisions at both boundaries", async (t) => {
  const base = await start(t);
  for (const [amount, decision, reason] of [[4999, "REJECT", "AMOUNT_OUT_OF_RANGE"], [5000, "APPROVE", "AMOUNT_IN_RANGE"], [50000, "APPROVE", "AMOUNT_IN_RANGE"], [50001, "REJECT", "AMOUNT_OUT_OF_RANGE"]]) {
    const result = await call(base, { task_id: `nlnet-${amount}`, input: { policy_id: "nlnet-first-grant-amount:v1", amount_eur: amount } });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get("x-agent-games-signature"), sign(result.text));
    assert.equal(result.body.decision, decision);
    assert.equal(result.body.reason_code, reason);
  }
});

test("rejects malformed ZK receipts before any verification", async (t) => {
  const base = await start(t);
  for (const receipt of [{}, { proof: {}, public_signals: ["1"] }, { ...shapedReceipt, public_signals: ["1", "2"] }, { ...shapedReceipt, public_signals: ["0x12"] }]) {
    const result = await call(base, { task_id: `bad-${JSON.stringify(receipt).length}`, input: { policy_id: "nlnet-first-grant-amount:v1", receipt } });
    assert.equal(result.body.decision, "REJECT");
    assert.equal(result.body.reason_code, "INVALID_RECEIPT");
  }
});

test("never approves a ZK receipt when the verifier or key is unavailable", async () => {
  // Uses the real verifier: without snarkjs/vkey it is unavailable; with them, this fake proof fails.
  const result = await decide({ input: { policy_id: "nlnet-first-grant-amount:v1", receipt: shapedReceipt } });
  assert.equal(result.decision, "REJECT");
  assert.ok(["VERIFIER_UNAVAILABLE", "ZK_PROOF_INVALID"].includes(result.reason_code), result.reason_code);
});

test("ZK decision follows the verifier result and echoes only the commitment", async () => {
  const accept = { verify: async () => true }, refuse = { verify: async () => false }, crash = { verify: async () => { throw new Error("bad point"); } };
  const task = { input: { policy_id: "nlnet-first-grant-amount:v1", receipt: shapedReceipt } };
  assert.deepEqual(await decide(task, accept), { decision: "APPROVE", reason_code: "ZK_PROOF_VALID", commitment: "123456789" });
  assert.deepEqual(await decide(task, refuse), { decision: "REJECT", reason_code: "ZK_PROOF_INVALID" });
  assert.deepEqual(await decide(task, crash), { decision: "REJECT", reason_code: "ZK_PROOF_INVALID" });
  assert.equal(parseZkReceipt({ ...shapedReceipt, amount: 12000 }).publicSignals.length, 1);
});

test("serves the app and the ZK script, nothing else", async (t) => {
  const base = await start(t);
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /id="zkForm"/);
  assert.equal((await fetch(`${base}/zk-receipt.js`)).status, 200);
  const og = await fetch(`${base}/og.png`);
  assert.equal(og.status, 200);
  assert.equal(og.headers.get("content-type"), "image/png");
  for (const icon of ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png"]) assert.equal((await fetch(`${base}${icon}`)).status, 200, icon);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/zk/../server.mjs`)).status, 404);
});

test("proof relay is disabled without a Kurier key and reports health", async (t) => {
  const base = await start(t);
  const attest = await fetch(`${base}/api/attest`, { method: "POST", body: JSON.stringify(shapedReceipt) });
  assert.equal(attest.status, 503);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.secretConfigured, true);
  assert.equal(health.attestationConfigured, false);
});

test("public agent check runs the ZK decision without the amount", async (t) => {
  const base = await start(t);
  const bad = await (await fetch(`${base}/api/agent/check`, { method: "POST", body: JSON.stringify({ proof: {}, public_signals: ["1"] }) })).json();
  assert.equal(bad.decision, "REJECT");
  assert.equal(bad.reason_code, "INVALID_RECEIPT");
  const fake = await (await fetch(`${base}/api/agent/check`, { method: "POST", body: JSON.stringify(shapedReceipt) })).json();
  assert.equal(fake.decision, "REJECT");
  assert.equal(fake.policy_id, "nlnet-first-grant-amount:v1");
});

const { screenApplication, redactAmounts, normalizeAssessment } = await import("./screen.mjs");
const { screenAndDecide } = await import("./policy.mjs");
const sampleApplication = "OpenCalSync is an EUPL-1.2 CalDAV (RFC 4791) library. Budget: 140 hours at €60/hour = €8,400; total requested €24,000 over 9 months. Users are in the Netherlands.";

test("the AI model never receives budget amounts", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let sentPrompt = "", sentKey = "";
  const fakeGemini = async (url, init) => {
    sentPrompt = JSON.parse(init.body).contents[0].parts[0].text;
    sentKey = init.headers["x-goog-api-key"];
    const answer = { project_summary: "A CalDAV library.", rules: [{ id: "open_licence", verdict: "PASS", evidence: "EUPL-1.2", reason: "Open licence named." }], suggestion: "Add tests." };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(answer) + "\n```" }] } }] }), { status: 200 });
  };
  const result = await screenApplication(sampleApplication, { fetchImpl: fakeGemini });
  delete process.env.GEMINI_API_KEY;
  assert.equal(sentKey, "test-key");
  for (const leaked of ["24,000", "8,400", "€60", "24000"]) assert.ok(!sentPrompt.includes(leaked), `prompt leaked ${leaked}`);
  assert.match(sentPrompt, /\[AMOUNT\]/);
  assert.equal(result.amounts_redacted, 3);
  assert.equal(result.rules.find(r => r.id === "open_licence").verdict, "PASS");
  assert.equal(result.overall, "NEEDS_WORK"); // unassessed rules default to NEEDS_INFO
});

test("model output is constrained to known rules and verdicts", () => {
  const out = normalizeAssessment({ rules: [{ id: "open_licence", verdict: "APPROVE_EVERYTHING" }, { id: "injected", verdict: "PASS" }], project_summary: "<script>x</script>".repeat(100) });
  assert.equal(out.rules.length, 7);
  assert.ok(out.rules.every(r => ["PASS", "NEEDS_INFO", "FAIL"].includes(r.verdict)));
  assert.equal(out.rules.find(r => r.id === "open_licence").verdict, "NEEDS_INFO");
  assert.ok(out.project_summary.length <= 400);
  assert.equal(redactAmounts("Version 2, 3 developers").count, 0);
});

test("screening approves only with all rules passed and a valid budget proof", async () => {
  const allPass = async () => ({ overall: "READY", rules: [], model: "test" });
  const oneFail = async () => ({ overall: "NOT_READY", rules: [], model: "test" });
  const accept = { verify: async () => true };
  assert.equal((await screenAndDecide({ application_text: "x", receipt: shapedReceipt }, accept, allPass)).decision, "APPROVE");
  const noProof = await screenAndDecide({ application_text: "x" }, accept, allPass);
  assert.equal(noProof.decision, "REJECT");
  assert.equal(noProof.reason_code, "BUDGET_PROOF_MISSING");
  const failed = await screenAndDecide({ application_text: "x", receipt: shapedReceipt }, accept, oneFail);
  assert.equal(failed.reason_code, "SCREEN_NOT_READY");
});

test("screening endpoint is off without a Gemini key", async (t) => {
  const base = await start(t);
  const res = await fetch(`${base}/api/screen`, { method: "POST", body: JSON.stringify({ application_text: sampleApplication }) });
  assert.equal(res.status, 503);
  assert.equal((await (await fetch(`${base}/api/screen/rules`)).json()).rules.length, 7);
});

test("Gemini is retried once on a 503 and the result is used", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rules: [] }) }] } }] }), { status: 200 });
  };
  const result = await screenApplication(sampleApplication, { fetchImpl: flaky });
  delete process.env.GEMINI_API_KEY;
  assert.equal(calls, 2);
  assert.equal(result.rules.length, 7);
});

test("opening an endpoint in a browser explains how to use it", async (t) => {
  const base = await start(t);
  for (const path of ["/api/screen", "/api/agent", "/api/agent/check", "/api/attest"]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    assert.match((await res.json()).endpoint, /^POST /);
  }
});
