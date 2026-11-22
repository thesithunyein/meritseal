// MeritSeal zero-knowledge receipts.
// Prove: the amount is within NLnet's €5,000–€50,000 range, without revealing it.
// The amount and salt never leave this page; only the proof and the Poseidon commitment are sent.
(() => {
  const $ = (id) => document.getElementById(id);
  const ZK = "/zk/";
  const RECEIPT_TYPE = "meritseal.zk-receipt.v2";
  const POLICY_ID = "nlnet-first-grant-amount:v1";
  const DONE = new Set(["Finalized", "Aggregated", "AggregationPublished", "Failed"]);
  let snarkjsPromise, keyPromise, current = null;

  const loadSnarkjs = () => snarkjsPromise ??= new Promise((resolve, reject) => {
    if (window.snarkjs) return resolve(window.snarkjs);
    const script = document.createElement("script");
    script.src = ZK + "snarkjs.min.js";
    script.onload = () => window.snarkjs ? resolve(window.snarkjs) : reject(new Error("snarkjs failed to load"));
    script.onerror = () => reject(new Error("Proof library unavailable"));
    document.head.append(script);
  });

  async function sha256Hex(text) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // Same canonicalisation as proof/setup.mjs, so the hash matches manifest.json.
  const loadKey = () => keyPromise ??= fetch(ZK + "vkey.json").then(r => {
    if (!r.ok) throw new Error("Verification key unavailable");
    return r.json();
  }).then(async vkey => ({ vkey, sha256: await sha256Hex(JSON.stringify(vkey)) }));

  function randomSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(31)); // 248 bits < BN254 field
    return BigInt("0x" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("")).toString();
  }
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const short = (s) => s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s;
  const encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const decode = (str) => JSON.parse(decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/")))));
  function status(el, text, tone) { el.textContent = text; if (tone) el.dataset.tone = tone; else delete el.dataset.tone; }
  function download(name, obj) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderReceipt() {
    const out = $("zkResult");
    if (!current) { out.hidden = true; return; }
    const r = current.receipt, z = r.zkverify;
    const safeUrl = z?.explorer_url && /^https:\/\/zkverify[\w.-]*\.subscan\.io\/extrinsic\/0x[0-9a-f]{64}$/i.test(z.explorer_url) ? z.explorer_url : null;
    const chain = !z ? "Not submitted" : safeUrl
      ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener">${esc(z.status)} · ${esc(short(z.tx_hash ?? ""))}</a>`
      : `${esc(z.status)}${z.job_id ? " · job " + esc(short(z.job_id)) : ""}`;
    out.innerHTML = `<article class="issued-receipt"><span class="result-label">Zero-knowledge receipt</span><h3>Amount within €5,000–€50,000</h3>
      <div class="result-row"><span>Policy</span><b>${esc(r.policy_id)}</b></div>
      <div class="result-row"><span>Amount</span><b>Hidden (never left this browser)</b></div>
      <div class="result-row"><span>Commitment</span><code title="${esc(r.commitment)}">${esc(short(r.commitment))}</code></div>
      <div class="result-row"><span>Proof</span><b>Groth16 · verified in browser</b></div>
      <div class="result-row"><span>zkVerify</span><b id="zkChain">${chain}</b></div>
      <div class="result-checks"><span>Share or keep</span><div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="button primary" type="button" id="zkCopyLink">Copy receipt link</button>
        <button class="button quiet" type="button" id="zkDownload">Download receipt</button>
        <button class="button quiet" type="button" id="zkOpening">Save private opening</button></div>
        <p class="receipt-limit" style="margin:10px 0 0;font-size:.85rem">The private opening (amount + salt) lets you later prove the exact amount to the funder. Keep it; do not share it with reviewers.</p></div>
      ${z && /^Relay/.test(z.status) ? '<p style="margin:10px 0 0"><button class="button quiet" type="button" id="zkRetry">Retry zkVerify submission</button></p>' : ""}
      <p class="toast" id="zkToast" hidden></p></article>`;
    out.hidden = false;
    const toast = (t) => { $("zkToast").textContent = t; $("zkToast").hidden = false; };
    $("zkCopyLink").onclick = async () => {
      const link = `${location.origin}${location.pathname}#zk-receipt=${encode(r)}`;
      try { await navigator.clipboard.writeText(link); toast("Receipt link copied. It contains the proof, not the amount."); }
      catch { prompt("Copy this receipt link", link); }
    };
    if ($("zkRetry")) $("zkRetry").onclick = () => { r.zkverify = { network: "zkVerify Volta testnet", status: "Retrying" }; renderReceipt(); anchor(r); };
    $("zkDownload").onclick = () => download(`meritseal-receipt-${r.commitment.slice(0, 8)}.json`, r);
    $("zkOpening").onclick = () => download(`meritseal-opening-PRIVATE-${r.commitment.slice(0, 8)}.json`, current.opening);
  }

  async function anchor(receipt, onUpdate) {
    const update = onUpdate ?? (() => renderReceipt());
    try {
      const res = await fetch("/api/attest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof: receipt.proof, public_signals: receipt.public_signals }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { receipt.zkverify = { network: "zkVerify Volta testnet", status: res.status === 503 ? "Relay not configured" : `Relay error (${body.error ?? res.status})` }; return update(); }
      receipt.zkverify = { network: "zkVerify Volta testnet", job_id: body.job_id, vk_hash: body.vk_hash, status: "Queued" };
      update();
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const s = await fetch(`/api/attest/${encodeURIComponent(body.job_id)}`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (!s) continue;
        Object.assign(receipt.zkverify, { status: s.status, tx_hash: s.tx_hash, explorer_url: s.explorer_url });
        update();
        if (DONE.has(s.status)) break;
      }
    } catch {
      receipt.zkverify = { network: "zkVerify Volta testnet", status: "Relay unreachable" };
      update();
    }
  }

  // Builds a v2 receipt for a whole-euro amount. Returns null when no proof can exist (out of range).
  async function makeReceipt(raw) {
    const [snarkjs, key] = await Promise.all([loadSnarkjs(), loadKey()]);
    const opening = { policy_id: POLICY_ID, amount: raw, salt: randomSalt() };
    let proved;
    try {
      proved = await snarkjs.groth16.fullProve({ amount: opening.amount, salt: opening.salt }, ZK + "nlnet-amount.wasm", ZK + "nlnet-amount.zkey");
    } catch {
      return null;
    }
    if (!await snarkjs.groth16.verify(key.vkey, proved.publicSignals, proved.proof)) throw new Error("Local verification failed");
    const receipt = {
      type: RECEIPT_TYPE, policy_id: POLICY_ID,
      statement: "The committed whole-euro amount is between €5,000 and €50,000 inclusive.",
      commitment: proved.publicSignals[0], public_signals: proved.publicSignals, proof: proved.proof,
      vkey_sha256: key.sha256, issued_at: new Date().toISOString(), zkverify: null
    };
    opening.commitment = receipt.commitment;
    return { receipt, opening };
  }

  async function prove(event) {
    event.preventDefault();
    const out = $("zkStatus"), button = $("zkProve"), raw = $("zkAmount").value.trim();
    current = null; renderReceipt();
    if (!/^[0-9]{1,6}$/.test(raw) || Number(raw) < 1) { $("zkAmount").setAttribute("aria-invalid", "true"); return status(out, "Enter a whole-euro amount, e.g. 12000.", "fail"); }
    $("zkAmount").removeAttribute("aria-invalid");
    button.disabled = true;
    status(out, "Generating proof in your browser…");
    try {
      const made = await makeReceipt(raw);
      if (!made) return status(out, `No proof exists for €${Number(raw).toLocaleString("en")}: the circuit only accepts amounts from €5,000 to €50,000. Nothing was sent.`, "fail");
      current = made;
      status(out, "Proof generated and verified. Sending proof (not the amount) to zkVerify…", "pass");
      renderReceipt();
      anchor(made.receipt);
    } catch (error) {
      status(out, `Could not generate a proof: ${error.message}`, "fail");
    } finally {
      button.disabled = false;
    }
  }

  async function verify(event) {
    event?.preventDefault();
    const out = $("zkVerifyStatus");
    let receipt;
    try { receipt = JSON.parse($("zkVerifyInput").value); } catch { return status(out, "Paste a MeritSeal receipt (JSON).", "fail"); }
    if (receipt?.type !== RECEIPT_TYPE || receipt.policy_id !== POLICY_ID || !Array.isArray(receipt.public_signals) || receipt.public_signals.length !== 1) {
      return status(out, "Not a MeritSeal v2 receipt for this policy.", "fail");
    }
    status(out, "Verifying proof…");
    try {
      const [snarkjs, key] = await Promise.all([loadSnarkjs(), loadKey()]);
      if (receipt.vkey_sha256 && receipt.vkey_sha256 !== key.sha256) return status(out, "Receipt was made with a different verification key than this site publishes.", "fail");
      if (receipt.commitment !== receipt.public_signals[0]) return status(out, "Commitment does not match the proof's public signal.", "fail");
      const ok = await snarkjs.groth16.verify(key.vkey, receipt.public_signals, receipt.proof).catch(() => false);
      if (!ok) return status(out, "Invalid: the proof does not verify. Do not trust this receipt.", "fail");
      const z = receipt.zkverify;
      const chain = z?.tx_hash ? ` Also verified on zkVerify (${z.status}).` : "";
      status(out, `Valid: the committed amount is between €5,000 and €50,000. The amount itself is not in the receipt.${chain}`, "pass");
      askAgent(receipt);
      const link = $("zkVerifyChain");
      if (z?.explorer_url && /^https:\/\/zkverify[\w.-]*\.subscan\.io\/extrinsic\/0x[0-9a-f]{64}$/i.test(z.explorer_url)) { link.href = z.explorer_url; link.hidden = false; }
      else link.hidden = true;
    } catch (error) {
      status(out, `Could not verify: ${error.message}`, "fail");
    }
  }

  // The MeritSeal agent re-checks the receipt server-side. It receives the proof and commitment only.
  async function askAgent(receipt) {
    const el = $("zkAgent");
    status(el, "Asking the MeritSeal agent…");
    try {
      const res = await fetch("/api/agent/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof: receipt.proof, public_signals: receipt.public_signals }) });
      const body = await res.json();
      if (!res.ok) return status(el, `Agent unavailable (${body.error ?? res.status}).`, "fail");
      status(el, `MeritSeal agent: ${body.decision} · ${body.reason_code}. The agent saw only the proof and commitment, not the amount.`, body.decision === "APPROVE" ? "pass" : "fail");
    } catch {
      status(el, "Agent unreachable.", "fail");
    }
  }

  function loadSharedReceipt() {
    const hash = location.hash;
    if (!hash.startsWith("#zk-receipt=")) return;
    try {
      $("zkVerifyInput").value = JSON.stringify(decode(hash.slice("#zk-receipt=".length)), null, 2);
      history.replaceState(null, "", "#zk");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      verify();
    } catch {
      status($("zkVerifyStatus"), "This receipt link is damaged.", "fail");
    }
  }

  // ---- AI screening -------------------------------------------------------------------------
  // Mirrors agent/screen.mjs: amounts are replaced before the text leaves the browser.
  function redactAmounts(text) {
    const pattern = /(?:€|\beur(?:os?)?\b|\$|\busd\b)\s*\d(?:[\d.,\s]*\d)?(?:\s?[km]\b)?|\d(?:[\d.,]*\d)?(?:\s?[km])?\s*(?:€|\beur(?:os?)?\b|\$|\busd\b)|(?<!\b(?:RFC|ISO|IEC|EN|IEEE)[\s-]?)\b(?:\d{1,3}(?:[.,\s]\d{3})+|\d{4,})\b/gi;
    let count = 0;
    return { redacted: text.replace(pattern, () => { count++; return "[AMOUNT]"; }), count };
  }
  const SAMPLES = {
    strong: { budget: "24000", text: `Project: OpenCalSync — a small, dependency-free CalDAV and CardDAV sync library in Rust for embedded Linux and Android.

Summary: Many community phone and router projects in Europe (postmarketOS, LineageOS forks, OpenWrt) cannot sync calendars and contacts without Google services. OpenCalSync implements the open standards CalDAV (RFC 4791), CardDAV (RFC 6352) and WebDAV-Sync (RFC 6578) in a library under 300 KB, with C bindings so existing apps can adopt it.

Licence: all code and documentation will be released under the EUPL-1.2, with an MIT-licensed C header so it can be embedded anywhere.

Budget breakdown:
1. Core sync engine and RFC 6578 incremental sync — 140 hours at €60/hour = €8,400
2. CardDAV support and conflict resolution — 110 hours at €60/hour = €6,600
3. C bindings and integration with postmarketOS calendar app — 90 hours at €60/hour = €5,400
4. Test suite against Nextcloud, Radicale and Baïkal servers — 50 hours at €60/hour = €3,000
5. Expenses: test devices — €600
Total requested: €24,000 over 9 months.

European dimension: the main users and both developers are in the EU (Netherlands and Portugal); the library removes a dependency on non-European cloud services for European free-software phones.

Background: I maintain a CalDAV client used by about 4,000 people and have contributed to Radicale. This proposal was written by me; no generative AI was used.` },
    weak: { budget: "55000", text: `Project: GrantGPT — the ultimate AI-powered growth platform for Web3 founders!!!

We will leverage cutting-edge AI to 10x your fundraising. Our platform automatically writes pitch decks, investor emails and grant applications for you, and our marketing team will run a global influencer campaign to reach 1M users in year one.

The money will be used for marketing, salaries and growth. We are a fast-moving startup based in Singapore and plan to expand to the US market. The code will be proprietary for now, but we may open parts of it later.

This application was generated with our own AI tool to show how powerful it is.` }
  };

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const VERDICT_LABEL = { PASS: "Pass", NEEDS_INFO: "Needs info", FAIL: "Fail" };

  function renderScreen(state) {
    const out = $("screenResult");
    out.replaceChildren();
    if (!state) { out.hidden = true; return; }
    out.hidden = false;
    const card = el("article", { class: "issued-receipt screen-report" });
    const r = state.result;
    if (r) {
      const decision = el("p", { class: "screen-decision", "data-decision": r.decision });
      decision.append(el("b", {}, r.decision === "APPROVE" ? "Ready to submit" : r.reason_code === "SCREEN_NOT_READY" || r.reason_code === "ZK_PROOF_INVALID" || r.reason_code === "BUDGET_PROOF_MISSING" ? "Not eligible as written" : "Needs work"), el("code", {}, ` ${r.decision} · ${r.reason_code}`));
      card.append(el("span", { class: "result-label" }, `MeritSeal agent · ${r.assessment.model}`), decision);
      if (r.assessment.project_summary) card.append(el("p", { class: "screen-summary" }, r.assessment.project_summary));
    } else {
      card.append(el("span", { class: "result-label" }, "MeritSeal agent"), el("p", { class: "screen-summary" }, "Screening…"));
    }
    const list = el("ol", { class: "screen-rules" });
    // Budget rule: decided by the zero-knowledge proof, never by the model.
    const b = el("li", { "data-verdict": state.receipt ? "PASS" : state.budgetFailed ? "FAIL" : "NEEDS_INFO" });
    const z = state.receipt?.zkverify;
    b.append(el("span", { class: "verdict" }, state.receipt ? "Pass" : state.budgetFailed ? "Fail" : "…"), el("b", {}, "Budget within €5,000–€50,000"));
    b.append(el("p", {}, state.receipt ? "Proven with a zero-knowledge proof in your browser. The amount was not sent to the agent or the AI model." : state.budgetFailed ? "No proof can exist for this amount: it is outside NLnet's first-grant range." : "Generating proof…"));
    if (state.receipt) {
      const chain = el("p", { class: "screen-chain" });
      const safe = z?.explorer_url && /^https:\/\/zkverify[\w.-]*\.subscan\.io\/extrinsic\/0x[0-9a-f]{64}$/i.test(z.explorer_url);
      if (safe) { const a = el("a", { href: z.explorer_url, target: "_blank", rel: "noopener" }, `zkVerify: ${z.status} · ${short(z.tx_hash)}`); chain.append(a); }
      else chain.textContent = `zkVerify: ${z?.status ?? "Submitting…"}`;
      b.append(chain);
    }
    list.append(b);
    for (const rule of r?.assessment.rules ?? []) {
      const li = el("li", { "data-verdict": rule.verdict });
      li.append(el("span", { class: "verdict" }, VERDICT_LABEL[rule.verdict]), el("b", {}, rule.label), el("p", {}, rule.reason));
      if (rule.evidence) li.append(el("q", {}, rule.evidence));
      li.append(el("small", {}, `Rule: ${rule.source}`));
      list.append(li);
    }
    card.append(list);
    if (r?.assessment.suggestion) card.append(el("p", { class: "screen-suggestion" }, `Suggestion: ${r.assessment.suggestion}`));
    const seen = el("details");
    seen.append(el("summary", {}, `What the AI model saw (${state.redactedCount} amount${state.redactedCount === 1 ? "" : "s"} removed)`), el("pre", {}, state.redacted));
    card.append(seen);
    if (state.receipt) {
      const actions = el("div", { class: "screen-actions" });
      const link = el("button", { class: "button quiet", type: "button" }, "Copy budget receipt link");
      link.onclick = async () => { const url = `${location.origin}${location.pathname}#zk-receipt=${encode(state.receipt)}`; try { await navigator.clipboard.writeText(url); link.textContent = "Link copied"; } catch { prompt("Copy this receipt link", url); } };
      const opening = el("button", { class: "button quiet", type: "button" }, "Save private opening");
      opening.onclick = () => download(`meritseal-opening-PRIVATE-${state.receipt.commitment.slice(0, 8)}.json`, state.opening);
      actions.append(link, opening);
      card.append(actions);
    }
    out.append(card);
  }

  async function screenApplication(event) {
    event.preventDefault();
    const out = $("screenStatus"), button = $("screenRun");
    const text = $("screenText").value.trim(), raw = $("screenBudget").value.trim();
    renderScreen(null);
    if (text.length < 80) return status(out, "Paste the application text (at least a few sentences).", "fail");
    if (!/^[0-9]{1,6}$/.test(raw) || Number(raw) < 1) return status(out, "Enter the requested budget as whole euros, e.g. 24000.", "fail");
    const { redacted, count } = redactAmounts(text);
    const state = { redacted, redactedCount: count, receipt: null, opening: null, budgetFailed: false, result: null };
    button.disabled = true;
    status(out, `Removed ${count} amount${count === 1 ? "" : "s"} from the text. Proving the budget in your browser…`);
    renderScreen(state);
    try {
      const made = await makeReceipt(raw);
      if (made) { state.receipt = made.receipt; state.opening = made.opening; } else state.budgetFailed = true;
      renderScreen(state);
      status(out, "Budget handled privately. The AI agent is reading the application…");
      const res = await fetch("/api/screen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ application_text: redacted, receipt: made ? { proof: made.receipt.proof, public_signals: made.receipt.public_signals } : undefined }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { status(out, res.status === 503 ? "The AI agent is not configured on this server." : res.status === 429 ? "Too many requests. Wait a minute and try again." : `The AI agent could not finish (${body.error ?? res.status}).`, "fail"); return; }
      state.result = body;
      renderScreen(state);
      status(out, body.decision === "APPROVE" ? "Screening complete: every rule passed." : "Screening complete. See the rules that need attention.", body.decision === "APPROVE" ? "pass" : "fail");
      if (state.receipt) anchor(state.receipt, () => renderScreen(state));
    } catch (error) {
      status(out, `Screening failed: ${error.message}`, "fail");
    } finally {
      button.disabled = false;
    }
  }

  $("screenForm").addEventListener("submit", screenApplication);
  for (const btn of document.querySelectorAll("[data-sample]")) btn.addEventListener("click", () => {
    const sample = SAMPLES[btn.dataset.sample];
    $("screenText").value = sample.text; $("screenBudget").value = sample.budget;
    status($("screenStatus"), "Sample loaded. Select “Screen application”.");
  });

  // ---- Batch audit ---------------------------------------------------------------------------
  // An auditor checks a whole funding round: every proof valid, no reused commitments, no amounts.
  function parseReceipts(text) {
    const found = [];
    for (const m of text.matchAll(/#zk-receipt=([A-Za-z0-9_-]+)/g)) { try { found.push(decode(m[1])); } catch { found.push(null); } }
    const rest = text.replace(/\S*#zk-receipt=[A-Za-z0-9_-]+/g, "").trim();
    if (!rest) return found;
    try {
      const parsed = JSON.parse(rest);
      return found.concat(Array.isArray(parsed) ? parsed : [parsed]);
    } catch {
      for (const chunk of rest.split(/\n\s*\n/)) { if (!chunk.trim()) continue; try { found.push(JSON.parse(chunk)); } catch { found.push(null); } }
      return found;
    }
  }

  async function auditReceipts(receipts) {
    const [snarkjs, key] = await Promise.all([loadSnarkjs(), loadKey()]);
    const seen = new Map();
    const rows = [];
    for (const [i, r] of receipts.entries()) {
      const row = { n: i + 1, commitment: r?.commitment ?? "", status: "INVALID", note: "", zk: r?.zkverify ?? null, issued: r?.issued_at ?? "" };
      if (!r || r.type !== RECEIPT_TYPE || r.policy_id !== POLICY_ID || !Array.isArray(r.public_signals) || r.public_signals.length !== 1) row.note = "Not a MeritSeal v2 receipt";
      else if (r.vkey_sha256 && r.vkey_sha256 !== key.sha256) row.note = "Different verification key";
      else if (r.commitment !== r.public_signals[0]) row.note = "Commitment mismatch";
      else if (!await snarkjs.groth16.verify(key.vkey, r.public_signals, r.proof).catch(() => false)) row.note = "Proof does not verify";
      else if (seen.has(r.commitment)) { row.status = "DUPLICATE"; row.note = `Same commitment as #${seen.get(r.commitment)}`; }
      else { row.status = "VALID"; row.note = "Amount within €5,000–€50,000"; seen.set(r.commitment, row.n); }
      rows.push(row);
    }
    return rows;
  }

  function renderAudit(rows) {
    const out = $("auditResult");
    out.replaceChildren();
    const valid = rows.filter(r => r.status === "VALID").length;
    const anchored = rows.filter(r => r.status === "VALID" && r.zk?.tx_hash).length;
    const summary = el("div", { class: "audit-summary" });
    const big = el("p", { class: "audit-big", "data-ok": String(valid === rows.length) }, `${valid}/${rows.length} within policy`);
    summary.append(big, el("p", {}, `${anchored} of ${valid} valid receipts carry a zkVerify transaction. ${rows.length - valid} rejected. No amounts were revealed: each row shows only a commitment.`));
    const table = el("table", { class: "audit-table" });
    const head = el("tr"); for (const h of ["#", "Commitment", "Result", "zkVerify", "Issued"]) head.append(el("th", {}, h));
    table.append(el("thead")); table.tHead.append(head);
    const tbody = el("tbody");
    for (const r of rows) {
      const tr = el("tr", { "data-status": r.status });
      tr.append(el("td", {}, String(r.n)), el("td", {}, r.commitment ? short(String(r.commitment)) : "—"));
      const res = el("td"); res.append(el("b", {}, r.status), el("small", {}, ` ${r.note}`)); tr.append(res);
      const zk = el("td");
      if (r.zk?.explorer_url && /^https:\/\/zkverify[\w.-]*\.subscan\.io\/extrinsic\/0x[0-9a-f]{64}$/i.test(r.zk.explorer_url)) zk.append(el("a", { href: r.zk.explorer_url, target: "_blank", rel: "noopener" }, r.zk.status ?? "tx"));
      else zk.textContent = r.zk?.status ?? "—";
      tr.append(zk, el("td", {}, r.issued ? new Date(r.issued).toLocaleDateString("en-GB") : "—"));
      tbody.append(tr);
    }
    table.append(tbody);
    out.append(summary, table);
    out.hidden = false;
  }

  async function runAudit(event) {
    event?.preventDefault();
    const out = $("auditStatus");
    const receipts = parseReceipts($("auditInput").value);
    if (!receipts.length) return status(out, "Paste receipts (JSON, a JSON array, or receipt links), or load files.", "fail");
    status(out, `Verifying ${receipts.length} receipt${receipts.length === 1 ? "" : "s"}…`);
    try { renderAudit(await auditReceipts(receipts)); status(out, "Audit complete.", "pass"); }
    catch (error) { status(out, `Audit failed: ${error.message}`, "fail"); }
  }

  // Demo round: real proofs for random in-range budgets, plus one tampered and one reused receipt.
  // Demo receipts are not sent to zkVerify, to save the shared relay quota.
  async function demoRound() {
    const out = $("auditStatus"), button = $("auditDemo");
    button.disabled = true;
    status(out, "Generating 5 applicants' proofs in your browser…");
    try {
      const receipts = [];
      for (let i = 0; i < 5; i++) {
        const amount = String(5000 + Math.floor(Math.random() * 45001));
        receipts.push((await makeReceipt(amount)).receipt);
      }
      const tampered = structuredClone(receipts[1]); tampered.public_signals = [(BigInt(tampered.public_signals[0]) + 1n).toString()]; tampered.commitment = tampered.public_signals[0];
      receipts.push(tampered, structuredClone(receipts[3]));
      if (current?.receipt) receipts.unshift(current.receipt);
      $("auditInput").value = JSON.stringify(receipts, null, 2);
      await runAudit();
    } catch (error) {
      status(out, `Could not build the demo round: ${error.message}`, "fail");
    } finally {
      button.disabled = false;
    }
  }

  $("auditForm").addEventListener("submit", runAudit);
  $("auditDemo").addEventListener("click", demoRound);
  $("auditFiles").addEventListener("change", async (e) => {
    const texts = await Promise.all([...e.target.files].map(f => f.text()));
    const receipts = texts.flatMap(t => parseReceipts(t));
    $("auditInput").value = JSON.stringify(receipts, null, 2);
    runAudit();
  });

  $("zkForm").addEventListener("submit", prove);
  $("zkVerifyForm").addEventListener("submit", verify);
  for (const btn of document.querySelectorAll("[data-zk-amount]")) btn.addEventListener("click", () => { $("zkAmount").value = btn.dataset.zkAmount; $("zkForm").requestSubmit(); });
  $("zkUseCurrent").addEventListener("click", () => { if (current) { $("zkVerifyInput").value = JSON.stringify(current.receipt, null, 2); verify(); } else status($("zkVerifyStatus"), "Generate a receipt first.", "fail"); });
  window.addEventListener("hashchange", loadSharedReceipt);
  loadSharedReceipt();
})();
