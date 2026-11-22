import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decide, loadVerifier, NLNET_POLICY_ID, parseZkReceipt, screenAndDecide } from "./policy.mjs";
import { geminiConfigured, geminiModel, SCREENING_RULES } from "./screen.mjs";
import { jobStatus, kurierConfigured, submitProof, vkHash } from "./kurier.mjs";

const secret = process.env.AGENT_GAMES_HMAC_SECRET ?? "";
const port = Number(process.env.PORT ?? 3000);
const completed = new Map(), TTL_MS = 86400000;
const PUBLIC = new URL("./public/", import.meta.url);

// Only these files are served; nothing else under public/ or the repo is reachable.
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8", "no-cache"],
  "/index.html": ["index.html", "text/html; charset=utf-8", "no-cache"],
  "/zk-receipt.js": ["zk-receipt.js", "text/javascript; charset=utf-8", "no-cache"],
  "/zk/snarkjs.min.js": ["zk/snarkjs.min.js", "text/javascript; charset=utf-8", "public, max-age=3600"],
  "/zk/nlnet-amount.wasm": ["zk/nlnet-amount.wasm", "application/wasm", "public, max-age=3600"],
  "/zk/nlnet-amount.zkey": ["zk/nlnet-amount.zkey", "application/octet-stream", "public, max-age=3600"],
  "/zk/vkey.json": ["zk/vkey.json", "application/json; charset=utf-8", "public, max-age=300"],
  "/zk/manifest.json": ["zk/manifest.json", "application/json; charset=utf-8", "public, max-age=300"]
};

const ENDPOINT_HELP = {
  "/api/screen": { endpoint: "POST /api/screen", agent: "meritseal", description: "AI screening of a grant application against NLnet's published rules. Amounts are removed before the model sees the text; the budget rule is satisfied only by a Groth16 proof verified on zkVerify.", body: { application_text: "string (amounts are redacted server-side too)", receipt: "optional { proof, public_signals } budget proof from the browser" }, returns: "decision (APPROVE | REJECT), reason_code, assessment.rules[] with verdict, evidence and reason", try_in_browser: "https://meritseal.vercel.app/#screen", rules: "GET /api/screen/rules" },
  "/api/agent": { endpoint: "POST /api/agent", description: "Agent Games task endpoint. Requests and responses are HMAC-SHA256 signed (x-agent-games-signature); task_id is an idempotency key.", inputs: ["{ task_id, input: { application_text, receipt? } }", "{ task_id, input: { policy_id: \"nlnet-first-grant-amount:v1\", receipt } }"], public_alternative: "POST /api/screen or POST /api/agent/check" },
  "/api/agent/check": { endpoint: "POST /api/agent/check", description: "The agent's decision on a budget proof alone (no amount is sent).", body: { proof: "Groth16 proof", public_signals: ["commitment"] }, returns: "APPROVE / ZK_PROOF_VALID or REJECT" },
  "/api/attest": { endpoint: "POST /api/attest", description: "Re-verifies a budget proof and submits it to zkVerify through Kurier.", body: { proof: "Groth16 proof", public_signals: ["commitment"] }, returns: "job_id; then GET /api/attest/:job_id for status and tx_hash" }
};

const sign = (raw) => createHmac("sha256", secret).update(raw).digest("hex");
function validSignature(raw, supplied = "") {
  const got = supplied.replace(/^sha256=/i, "").trim().toLowerCase(), expected = sign(raw);
  return Boolean(got) && got.length === expected.length && /^[0-9a-f]+$/.test(got)
    && timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}
function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(secret ? { "x-agent-games-signature": sign(raw) } : {}) });
  res.end(raw);
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function rawBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > 65536) { reject(new Error("too_large")); req.destroy(); } else parts.push(c); });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}
function prune() { const now = Date.now(); for (const [id, entry] of completed) if (now - entry.savedAt > TTL_MS) completed.delete(id); }

async function serveStatic(res, path) {
  const entry = STATIC[path];
  if (!entry) return false;
  try {
    const body = await readFile(new URL(entry[0], PUBLIC));
    res.writeHead(200, { "content-type": entry[1], "cache-control": entry[2], "x-content-type-options": "nosniff" });
    res.end(body);
  } catch {
    json(res, 404, { error: "not_found" });
  }
  return true;
}

// Per-IP limit on proof submissions, so the public relay endpoint cannot drain the Kurier quota.
const attempts = new Map();
function rateLimited(req, limit = 6, windowMs = 60000) {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < windowMs);
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 5000) attempts.clear();
  return recent.length > limit;
}

// POST /api/attest: the browser sends only the proof and the commitment (never the amount).
// The server re-verifies the proof locally, then relays it to zkVerify through Kurier.
async function attest(req, res) {
  if (!kurierConfigured()) return json(res, 503, { error: "attestation_not_configured" });
  if (rateLimited(req)) return json(res, 429, { error: "rate_limited" });
  let body;
  try { body = JSON.parse(await rawBody(req)); } catch { return json(res, 400, { error: "invalid_json" }); }
  const parsed = parseZkReceipt(body);
  if (!parsed) return json(res, 400, { error: "invalid_receipt" });
  const verifier = await loadVerifier();
  if (!verifier) return json(res, 503, { error: "verifier_unavailable" });
  if (!await verifier.verify(parsed.proof, parsed.publicSignals).catch(() => false)) return json(res, 422, { error: "proof_invalid" });
  try {
    return json(res, 202, await submitProof(verifier.vkey, parsed.proof, parsed.publicSignals));
  } catch (error) {
    return json(res, 502, { error: "relay_failed", detail: String(error.message ?? error).slice(0, 80) });
  }
}

// POST /api/agent/check: public demo of the agent's ZK decision (unsigned, rate-limited).
// Reviewers can watch the agent approve a receipt without the amount ever being sent.
async function agentCheck(req, res) {
  if (rateLimited(req, 20)) return json(res, 429, { error: "rate_limited" });
  let body;
  try { body = JSON.parse(await rawBody(req)); } catch { return json(res, 400, { error: "invalid_json" }); }
  const result = await decide({ input: { policy_id: NLNET_POLICY_ID, receipt: body?.receipt ?? body } });
  return json(res, 200, { agent: "meritseal", policy_id: NLNET_POLICY_ID, ...result, checked_at: new Date().toISOString() });
}

// POST /api/screen: the AI agent screens a (redacted) application and, if a ZK receipt is attached,
// checks the budget proof too. The browser has already removed amounts; the server redacts again.
async function screen(req, res) {
  if (!geminiConfigured()) return json(res, 503, { error: "screening_not_configured" });
  if (rateLimited(req, 5)) return json(res, 429, { error: "rate_limited" });
  let body;
  try { body = JSON.parse(await rawBody(req)); } catch { return json(res, 400, { error: "invalid_json" }); }
  if (typeof body?.application_text !== "string") return json(res, 400, { error: "missing_application_text" });
  try {
    const result = await screenAndDecide({ application_text: body.application_text, receipt: body.receipt });
    return json(res, 200, { agent: "meritseal", policy_id: NLNET_POLICY_ID, ...result, checked_at: new Date().toISOString() });
  } catch (error) {
    const code = String(error.message ?? error);
    return json(res, code === "application_too_short" ? 400 : 502, { error: code.slice(0, 60) });
  }
}

async function attestStatus(res, jobId) {
  if (!kurierConfigured()) return json(res, 503, { error: "attestation_not_configured" });
  if (!/^[0-9a-f-]{8,64}$/i.test(jobId)) return json(res, 400, { error: "invalid_job_id" });
  try { return json(res, 200, await jobStatus(jobId)); }
  catch (error) { return json(res, 502, { error: "relay_failed", detail: String(error.message ?? error).slice(0, 80) }); }
}

async function agentTask(req, res) {
  if (!secret) return send(res, 503, { error: "secret_not_configured" });
  let raw;
  try { raw = await rawBody(req); } catch { return send(res, 413, { error: "payload_too_large" }); }
  if (!validSignature(raw, req.headers["x-agent-games-signature"])) return send(res, 401, { error: "invalid_signature" });
  let task;
  try { task = JSON.parse(raw); } catch { return send(res, 400, { error: "invalid_json" }); }
  if (task.type === "agent-games.preflight.v1") return send(res, 200, { ok: true, protocolVersion: "v1" });
  const deadline = task.deadline_at ?? task.deadlineAt;
  if (deadline && Number.isFinite(Date.parse(deadline)) && Date.now() > Date.parse(deadline)) {
    return send(res, 408, { decision: "REJECT", reason_code: "DEADLINE_EXPIRED" });
  }
  const taskId = task.task_id ?? task.taskId;
  if (!taskId || typeof taskId !== "string") return send(res, 400, { error: "missing_task_id" });
  prune();
  const cached = completed.get(taskId);
  if (cached) return send(res, 200, cached.body);
  const body = { task_id: taskId, ...(await decide(task)), agent: "meritseal", protocolVersion: "v1" };
  completed.set(taskId, { body, savedAt: Date.now() });
  return send(res, 200, body);
}

export function createAgentServer() {
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "GET" && await serveStatic(res, path)) return;
      if (req.method === "GET" && (path === "/health" || path === "/api/health")) {
        const verifier = await loadVerifier();
        return json(res, 200, { ok: true, service: "meritseal-agent", secretConfigured: Boolean(secret), zkVerifierLoaded: Boolean(verifier), attestationConfigured: kurierConfigured(), screeningConfigured: geminiConfigured() });
      }
      if (req.method === "POST" && path === "/api/attest") return await attest(req, res);
      if (req.method === "POST" && path === "/api/agent/check") return await agentCheck(req, res);
      if (req.method === "POST" && path === "/api/screen") return await screen(req, res);
      // A browser visit to an endpoint explains how to call it, instead of a bare 404.
      if (req.method === "GET" && (path === "/api/screen" || path === "/api/agent" || path === "/api/agent/check" || path === "/api/attest")) return json(res, 200, ENDPOINT_HELP[path]);
      if (req.method === "GET" && path === "/api/screen/rules") return json(res, 200, { policy_id: NLNET_POLICY_ID, model: geminiModel(), rules: SCREENING_RULES });
      if (req.method === "GET" && path.startsWith("/api/attest/")) return await attestStatus(res, path.slice("/api/attest/".length));
      if (req.method === "POST" && (path === "/agent" || path === "/api/agent")) return await agentTask(req, res);
      return json(res, 404, { error: "not_found" });
    } catch {
      if (!res.headersSent) json(res, 500, { error: "internal_error" });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAgentServer().listen(port, () => console.log(`MeritSeal agent listening on ${port}`));
  // Warm up: register the verification key with Kurier at boot so the first user doesn't wait.
  if (kurierConfigured()) loadVerifier().then(v => v && vkHash(v.vkey)).catch(error => console.error(`[kurier] warm-up failed: ${error.message}`));
}
