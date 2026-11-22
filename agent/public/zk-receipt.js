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
    const label = recordLabel(z);
    const chain = !z ? "Sending…" : safeUrl
      ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener">${esc(label)} · view on zkVerify</a>`
      : esc(/^Relay/.test(z.status) ? "Not recorded yet" : label);
    out.innerHTML = `<article class="issued-receipt"><span class="result-label">Budget proof</span><h3>Your budget is within €5,000–€50,000</h3>
      <div class="result-row"><span>Budget</span><b>Hidden: it never left this device</b></div>
      <div class="result-row"><span>Anonymous ID</span><code title="${esc(r.commitment)}">${esc(short(r.commitment))}</code></div>
      <div class="result-row"><span>Proof</span><b>Checked on this device</b></div>
      <div class="result-row"><span>Public record</span><b id="zkChain">${chain}</b></div>
      <div class="result-checks"><div class="row">
        <button class="button primary small" type="button" id="zkCopyLink">Copy proof link</button>
        <button class="button quiet small" type="button" id="zkDownload">Download proof</button>
        <button class="button quiet small" type="button" id="zkOpening">Save secret file</button></div>
        <p class="hint" style="margin:8px 0 0">Share the proof link with anyone. Keep the secret file private: it contains the exact amount, for when a funder asks you to confirm it.</p></div>
      ${z && /^Relay/.test(z.status) ? '<p style="margin:0"><button class="button quiet small" type="button" id="zkRetry">Try recording again</button></p>' : ""}
      <p class="toast" id="zkToast" hidden></p></article>`;
    out.hidden = false;
    const toast = (t) => { $("zkToast").textContent = t; $("zkToast").hidden = false; };
    $("zkCopyLink").onclick = async () => {
      const link = `${location.origin}${location.pathname}#zk-receipt=${encode(r)}`;
      try { await navigator.clipboard.writeText(link); toast("Proof link copied. It contains the proof, not the amount."); }
      catch { prompt("Copy this receipt link", link); }
    };
    if ($("zkRetry")) $("zkRetry").onclick = () => { r.zkverify = { network: "zkVerify Volta testnet", status: "Retrying" }; renderReceipt(); anchor(r); };
    $("zkDownload").onclick = () => download(`meritseal-proof-${r.commitment.slice(0, 8)}.json`, r);
    $("zkOpening").onclick = () => download(`meritseal-secret-${r.commitment.slice(0, 8)}.json`, current.opening);
  }

  async function anchor(receipt, onUpdate) {
    const update = onUpdate ?? (() => renderReceipt());
    try {
      const res = await fetch("/api/attest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof: receipt.proof, public_signals: receipt.public_signals }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { receipt.zkverify = { network: "zkVerify Volta testnet", status: res.status === 503 ? "Relay not configured" : `Relay error (${body.error ?? res.status})` }; return update(); }
      receipt.zkverify = { network: "zkVerify Volta testnet", job_id: body.job_id, vk_hash: body.vk_hash, status: "Queued" };
      update();
      for (let i = 0; i < 90; i++) {
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
    if (!/^[0-9]{1,6}$/.test(raw) || Number(raw) < 1) { $("zkAmount").setAttribute("aria-invalid", "true"); return status(out, "Enter your budget in whole euros, for example 12000.", "fail"); }
    $("zkAmount").removeAttribute("aria-invalid");
    button.disabled = true;
    status(out, "Creating your proof on this device (a few seconds)…");
    try {
      const made = await makeReceipt(raw);
      if (!made) return status(out, `€${Number(raw).toLocaleString("en")} is outside NLnet's €5,000–€50,000 range, so no proof can be made. Nothing was sent.`, "fail");
      current = made;
      status(out, "Proof created. Recording it publicly on zkVerify (the amount is not included)…", "pass");
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
    try { receipt = JSON.parse($("zkVerifyInput").value); } catch { return status(out, "Paste a MeritSeal proof, or open a proof link.", "fail"); }
    if (receipt?.type !== RECEIPT_TYPE || receipt.policy_id !== POLICY_ID || !Array.isArray(receipt.public_signals) || receipt.public_signals.length !== 1) {
      return status(out, "This is not a MeritSeal budget proof.", "fail");
    }
    status(out, "Verifying proof…");
    try {
      const [snarkjs, key] = await Promise.all([loadSnarkjs(), loadKey()]);
      if (receipt.vkey_sha256 && receipt.vkey_sha256 !== key.sha256) return status(out, "This proof was made with a different key than this site uses, so it cannot be trusted here.", "fail");
      if (receipt.commitment !== receipt.public_signals[0]) return status(out, "This proof has been altered: its ID does not match the proof.", "fail");
      const ok = await snarkjs.groth16.verify(key.vkey, receipt.public_signals, receipt.proof).catch(() => false);
      if (!ok) return status(out, "Not valid: this proof has been altered or is broken. Do not trust it.", "fail");
      const z = receipt.zkverify;
      const chain = z?.tx_hash ? ` It is also recorded on zkVerify.` : "";
      status(out, `Valid: the budget behind this proof is between €5,000 and €50,000. The amount itself is not in the proof.${chain}`, "pass");
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
    status(el, "Asking the MeritSeal agent to check it too…");
    try {
      const res = await fetch("/api/agent/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof: receipt.proof, public_signals: receipt.public_signals }) });
      const body = await res.json();
      if (!res.ok) return status(el, `Agent unavailable (${body.error ?? res.status}).`, "fail");
      status(el, `MeritSeal agent agrees: ${body.decision === "APPROVE" ? "approved" : "rejected"} (${body.reason_code}). The agent saw only the proof, not the amount.`, body.decision === "APPROVE" ? "pass" : "fail");
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
      status($("zkVerifyStatus"), "This proof link is damaged or incomplete.", "fail");
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
  const STEPS = [["redact", "Removing amounts from your text"], ["prove", "Checking your budget on this device"], ["ai", "AI agent reading your application"], ["record", "Recording the budget proof publicly"]];
  const safeExplorer = (url) => url && /^https:\/\/zkverify[\w.-]*\.subscan\.io\/extrinsic\/0x[0-9a-f]{64}$/i.test(url) ? url : null;
  const RECORD_TEXT = { Queued: "Sending…", Submitted: "Sending…", IncludedInBlock: "Recorded, confirming…", Finalized: "Confirmed", Aggregated: "Confirmed", AggregationPublished: "Confirmed", Failed: "Could not be recorded" };
  // Once a transaction hash exists the proof is on-chain, even if the relay still reports "Submitted".
  const recordLabel = (z) => z?.tx_hash && (z.status === "Queued" || z.status === "Submitted") ? "Recorded, confirming…" : RECORD_TEXT[z?.status] ?? z?.status ?? "Sending…";

  // Builds the list of checks shown to the person: the budget (decided by math) plus the AI's seven rules.
  function checksFor(state) {
    const budget = state.receipt
      ? { id: "budget", label: "Budget within €5,000–€50,000", verdict: "PASS", reason: "Your budget is inside NLnet's range for a first grant. It was checked on this device; the number was never shared.", source: "\"Between € 5 000 and € 50 000 for a first grant.\"" }
      : { id: "budget", label: "Budget within €5,000–€50,000", verdict: "FAIL", reason: state.budgetLow ? "Your budget is below NLnet's minimum of €5,000 for a first grant. Raise it, or check whether a smaller fund fits better." : "Your budget is above NLnet's maximum of €50,000 for a first grant. Reduce the scope or split the work into phases.", source: "\"Between € 5 000 and € 50 000 for a first grant.\"" };
    return [budget, ...(state.result?.assessment.rules ?? [])];
  }

  function reportText(state) {
    const r = state.result, checks = checksFor(state);
    const lines = [`MeritSeal application check: ${r.decision === "APPROVE" ? "Ready to submit" : "Needs changes"}`, `Checked ${new Date(r.checked_at ?? Date.now()).toLocaleString()} against NLnet's published requirements (nlnet.nl/propose).`, ""];
    if (r.assessment.project_summary) lines.push(`Project (as the AI understood it): ${r.assessment.project_summary}`, "");
    for (const c of checks) lines.push(`[${VERDICT_LABEL[c.verdict]}] ${c.label}: ${c.reason}${c.evidence ? ` (quote: "${c.evidence}")` : ""}`);
    if (r.assessment.suggestion) lines.push("", `Suggestion: ${r.assessment.suggestion}`);
    const z = state.receipt?.zkverify;
    if (z?.explorer_url) lines.push("", `Budget proof public record: ${z.explorer_url}`);
    lines.push("", "This report is advisory; NLnet decides eligibility. The budget amount is not included.");
    return lines.join("\n");
  }

  function renderProgress(state) {
    const list = el("ol", { class: "progress", "aria-label": "Progress" });
    for (const [id, label] of STEPS) {
      if (id === "record" && state.budgetFailed) continue;
      const slow = id === "ai" && state.slow && state.steps.ai === "active";
      list.append(el("li", { "data-state": state.steps[id] ?? "pending" }, slow ? `${label} (taking a little longer than usual…)` : label));
    }
    return list;
  }

  function renderScreen(state) {
    const out = $("screenResult"), placeholder = $("screenPlaceholder");
    out.replaceChildren();
    out.parentElement.classList.toggle("static", Boolean(state?.result));
    // Left-hand summary, so the form column stays useful next to a long report.
    const note = $("screenReady");
    if (state?.result) {
      const ok = state.result.decision === "APPROVE";
      const todo = checksFor(state).filter(c => c.verdict !== "PASS").length;
      note.dataset.ok = String(ok);
      note.querySelector(".dot").textContent = ok ? "✓" : "!";
      $("screenReadyTitle").textContent = ok ? "Report ready: all checks passed" : `Report ready: ${todo} thing${todo === 1 ? "" : "s"} to fix`;
      $("screenReadyText").textContent = ok ? "Copy or download it from the report. You can edit and check again anytime." : "Fix them in your text above, then select Check my application again.";
      note.hidden = false;
    } else note.hidden = true;
    if (!state) { out.hidden = true; placeholder.hidden = false; return; }
    out.hidden = false; placeholder.hidden = true;
    const panel = el("div", { class: "panel" });
    const r = state.result;
    if (!r) {
      panel.append(el("h3", {}, state.error ? "Something went wrong" : "Checking your application…"), renderProgress(state));
      if (state.error) {
        panel.append(el("output", { "data-tone": "fail" }, state.error));
        const again = el("button", { class: "button primary small", type: "button" }, "Try again");
        again.onclick = () => $("screenForm").requestSubmit();
        panel.append(again);
      }
      out.append(panel);
      return;
    }
    const checks = checksFor(state);
    const fails = checks.filter(c => c.verdict === "FAIL"), infos = checks.filter(c => c.verdict === "NEEDS_INFO"), passes = checks.filter(c => c.verdict === "PASS");
    const ok = r.decision === "APPROVE";
    const card = el("div", { class: "verdict-card", "data-ok": String(ok) });
    const todo = fails.length + infos.length;
    card.append(el("h3", {}, ok ? "Ready to submit" : `Fix ${todo} thing${todo === 1 ? "" : "s"} before you submit`),
      el("p", {}, `${passes.length} of ${checks.length} checks passed.${ok ? " Your application meets every published requirement we check." : " Start with the items below."}`));
    panel.append(card);
    // The budget proof's public record stays visible even when the passing checks are folded away.
    if (state.receipt) {
      const z = state.receipt.zkverify, url = safeExplorer(z?.explorer_url);
      const line = el("p", { class: "proof-line" });
      line.append(el("span", { class: "dot", "aria-hidden": "true" }, "🔒"), "Budget proven in range on this device. Public record: ");
      if (url) line.append(el("a", { href: url, target: "_blank", rel: "noopener" }, `${recordLabel(z)} · view on zkVerify`));
      else line.append(z?.status && /^Relay/.test(z.status) ? "not recorded yet" : RECORD_TEXT[z?.status] ?? "Sending…");
      panel.append(line);
    } else if (state.budgetFailed) {
      const line = el("p", { class: "proof-line", "data-ok": "false" });
      line.append(el("span", { class: "dot", "aria-hidden": "true" }, "🔒"), state.budgetLow ? "Budget below €5,000: no proof can be made, so nothing about it was shared." : "Budget above €50,000: no proof can be made, so nothing about it was shared.");
      panel.append(line);
    }
    if (r.assessment.project_summary) panel.append(el("p", { class: "hint" }, `The AI understood your project as: ${r.assessment.project_summary}`));

    // Compact row: verdict, rule and one-line reason. Expanding it shows the quote and NLnet's wording.
    const ruleItem = (c) => {
      const li = el("li", { "data-verdict": c.verdict });
      const d = el("details"), sum = el("summary"), head = el("span", { class: "rule-head" });
      head.append(el("span", { class: "tag" }, VERDICT_LABEL[c.verdict]), el("b", {}, c.label));
      sum.append(el("span", { class: "rule-main" }));
      sum.firstChild.append(head, el("span", { class: "rule-reason" }, c.reason));
      d.append(sum);
      const more = el("div", { class: "rule-more" });
      if (c.evidence) more.append(el("q", {}, `From your text: ${c.evidence}`));
      if (c.id === "budget" && state.receipt) {
        const z = state.receipt.zkverify, rec = el("p", { class: "public-record" });
        const url = safeExplorer(z?.explorer_url);
        rec.append("Public proof record: ");
        if (url) rec.append(el("a", { href: url, target: "_blank", rel: "noopener" }, `${recordLabel(z)} · view on zkVerify`));
        else rec.append(z?.status && /^Relay/.test(z.status) ? "not recorded yet " : RECORD_TEXT[z?.status] ?? "Sending…");
        if (z?.status && /^Relay/.test(z.status)) { const retry = el("button", { class: "button quiet small", type: "button" }, "Try recording again"); retry.onclick = () => { state.receipt.zkverify = { status: "Queued" }; renderScreen(state); anchor(state.receipt, () => renderScreen(state)); }; rec.append(retry); }
        more.append(rec);
      }
      more.append(el("small", {}, `NLnet rule: ${c.source}`));
      d.append(more);
      li.append(d);
      return li;
    };
    const group = (title, items, open = true) => {
      if (!items.length) return;
      const list = el("ol", { class: "rules" }); items.forEach((c, i) => { const li = ruleItem(c); li.style.setProperty("--i", i); list.append(li); });
      if (open) { panel.append(el("p", { class: "group-title" }, title), list); }
      else { const d = el("details"); d.append(el("summary", {}, title)); const wrap = el("div"); wrap.append(list); d.append(wrap); panel.append(d); }
    };
    group(`Fix these first (${fails.length})`, fails);
    group(`Add more detail (${infos.length})`, infos);
    group(`Already good (${passes.length})`, passes, false);
    if (r.assessment.suggestion) panel.append(el("p", { class: "tip" }, `Suggestion: ${r.assessment.suggestion}`));

    const actions = el("div", { class: "row" });
    const copy = el("button", { class: "button primary small", type: "button" }, "Copy report");
    copy.onclick = async () => { try { await navigator.clipboard.writeText(reportText(state)); copy.textContent = "Copied"; } catch { prompt("Copy your report", reportText(state)); } };
    const save = el("button", { class: "button quiet small", type: "button" }, "Download report");
    save.onclick = () => { const url = URL.createObjectURL(new Blob([reportText(state)], { type: "text/plain" })); const a = Object.assign(document.createElement("a"), { href: url, download: "meritseal-report.txt" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    const again = el("button", { class: "button quiet small", type: "button" }, "Edit and check again");
    again.onclick = () => { $("screenText").focus(); $("screenText").scrollIntoView({ block: "center" }); };
    actions.append(copy, save, again);
    panel.append(actions);

    const seen = el("details");
    seen.append(el("summary", {}, `What the AI saw (${state.redactedCount} amount${state.redactedCount === 1 ? "" : "s"} removed)`), el("pre", {}, state.redacted));
    panel.append(seen);
    if (state.receipt) {
      const adv = el("details"), box = el("div");
      adv.append(el("summary", {}, "Share or keep your budget proof"));
      box.append(el("p", { class: "hint" }, "The proof link lets anyone confirm your budget is in range without seeing it. The secret file contains the exact amount: keep it private and use it only if a funder asks you to confirm the real number."));
      const row = el("div", { class: "row" });
      const link = el("button", { class: "button quiet small", type: "button" }, "Copy proof link");
      link.onclick = async () => { const url = `${location.origin}${location.pathname}#zk-receipt=${encode(state.receipt)}`; try { await navigator.clipboard.writeText(url); link.textContent = "Link copied"; } catch { prompt("Copy this proof link", url); } };
      const secret = el("button", { class: "button quiet small", type: "button" }, "Save secret file");
      secret.onclick = () => download(`meritseal-secret-${state.receipt.commitment.slice(0, 8)}.json`, state.opening);
      row.append(link, secret); box.append(row); adv.append(box); panel.append(adv);
    }
    panel.append(el("p", { class: "hint" }, `Checked by the MeritSeal agent (${r.assessment.model}) · decision ${r.decision} · ${r.reason_code}. Advisory only: NLnet makes its own decisions.`));
    out.append(panel);
  }

  async function screenApplication(event) {
    event.preventDefault();
    const out = $("screenStatus"), button = $("screenRun"), textEl = $("screenText"), budgetEl = $("screenBudget");
    const text = textEl.value.trim(), raw = budgetEl.value.trim().replace(/[€\s,._]/g, "");
    textEl.removeAttribute("aria-invalid"); budgetEl.removeAttribute("aria-invalid");
    if (text.length < 80) { textEl.setAttribute("aria-invalid", "true"); textEl.focus(); return status(out, "Paste your application text first (at least a few sentences). Or select “Use a strong example”.", "fail"); }
    if (!/^[0-9]{1,7}$/.test(raw) || Number(raw) < 1) { budgetEl.setAttribute("aria-invalid", "true"); budgetEl.focus(); return status(out, "Enter your total budget in whole euros, for example 24000.", "fail"); }
    status(out, "");
    const { redacted, count } = redactAmounts(text);
    const state = { redacted, redactedCount: count, receipt: null, opening: null, budgetFailed: false, result: null, error: null, steps: { redact: "done", prove: "active" } };
    button.disabled = true; button.textContent = "Checking…";
    renderScreen(state);
    if (matchMedia("(max-width: 900px)").matches) $("screenResult").scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const made = await makeReceipt(raw);
      if (made) { state.receipt = made.receipt; state.opening = made.opening; current = made; } else { state.budgetFailed = true; state.budgetLow = Number(raw) < 5000; }
      state.steps.prove = "done"; state.steps.ai = "active"; renderScreen(state);
      const slowTimer = setTimeout(() => { if (state.steps.ai === "active") { state.slow = true; renderScreen(state); } }, 15000);
      const res = await fetch("/api/screen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ application_text: redacted, receipt: made ? { proof: made.receipt.proof, public_signals: made.receipt.public_signals } : undefined }) });
      const body = await res.json().catch(() => ({}));
      clearTimeout(slowTimer);
      if (!res.ok) {
        state.steps.ai = "failed";
        state.error = res.status === 429 ? "Too many checks in a short time. Wait a minute, then try again." : res.status === 400 && body.error === "application_too_short" ? "The application is too short to assess. Add more detail and try again." : "The AI agent is busy or unavailable right now. Your budget was not shared. Please try again in a moment.";
        return renderScreen(state);
      }
      state.steps.ai = "done"; state.result = body;
      renderScreen(state);
      if (state.receipt) { state.steps.record = "active"; anchor(state.receipt, () => renderScreen(state)); }
    } catch (error) {
      state.error = `Something went wrong on this device: ${error.message}. Please reload the page and try again.`;
      for (const k of Object.keys(state.steps)) if (state.steps[k] === "active") state.steps[k] = "failed";
      renderScreen(state);
    } finally {
      button.disabled = false; button.textContent = "Check my application";
    }
  }

  // Examples fill the form and run the check straight away: one click to a full report.
  function runSample(name) {
    if ($("screenRun").disabled) return;
    const sample = SAMPLES[name];
    $("screenText").value = sample.text; $("screenBudget").value = sample.budget;
    $("screenForm").requestSubmit();
  }
  $("screenForm").addEventListener("submit", screenApplication);
  for (const btn of document.querySelectorAll("[data-sample]")) btn.addEventListener("click", () => runSample(btn.dataset.sample));
  for (const link of document.querySelectorAll("[data-try-sample]")) link.addEventListener("click", () => setTimeout(() => runSample(link.dataset.trySample), 50));

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
      if (!r || r.type !== RECEIPT_TYPE || r.policy_id !== POLICY_ID || !Array.isArray(r.public_signals) || r.public_signals.length !== 1) row.note = "Not a MeritSeal budget proof";
      else if (r.vkey_sha256 && r.vkey_sha256 !== key.sha256) row.note = "Made with a different proof key";
      else if (r.commitment !== r.public_signals[0]) row.note = "Altered: ID does not match the proof";
      else if (!await snarkjs.groth16.verify(key.vkey, r.public_signals, r.proof).catch(() => false)) row.note = "Altered: the math does not check out";
      else if (seen.has(r.commitment)) { row.status = "DUPLICATE"; row.note = `Same proof as #${seen.get(r.commitment)}, reused`; }
      else { row.status = "VALID"; row.note = "Budget within €5,000–€50,000"; seen.set(r.commitment, row.n); }
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
    const big = el("p", { class: "audit-big", "data-ok": String(valid === rows.length) }, `${valid} of ${rows.length} within the budget rule`);
    summary.append(big, el("p", {}, `${rows.length - valid} rejected. ${anchored} of the valid proofs also have a public zkVerify record. No budget was revealed: each row shows only an anonymous ID.`));
    const table = el("table", { class: "audit-table" });
    const head = el("tr"); for (const h of ["#", "Anonymous ID", "Result", "Public record", "Created"]) head.append(el("th", {}, h));
    table.append(el("thead")); table.tHead.append(head);
    const tbody = el("tbody");
    for (const r of rows) {
      const tr = el("tr", { "data-status": r.status }); tr.style.setProperty("--i", r.n);
      tr.append(el("td", {}, String(r.n)), el("td", {}, r.commitment ? short(String(r.commitment)) : "—"));
      const res = el("td"); res.append(el("b", {}, { VALID: "Valid", INVALID: "Rejected", DUPLICATE: "Copy" }[r.status]), el("small", {}, r.note)); tr.append(res);
      const zk = el("td");
      if (r.zk?.explorer_url && /^https:\/\/zkverify[\w.-]*\.subscan\.io\/extrinsic\/0x[0-9a-f]{64}$/i.test(r.zk.explorer_url)) zk.append(el("a", { href: r.zk.explorer_url, target: "_blank", rel: "noopener" }, r.zk.status ?? "tx"));
      else zk.textContent = r.zk?.status ?? "—";
      tr.append(zk, el("td", {}, r.issued ? new Date(r.issued).toLocaleDateString("en-GB") : "—"));
      tbody.append(tr);
    }
    table.append(tbody);
    const scroll = el("div", { class: "table-scroll" }); scroll.append(table);
    const panel = el("div", { class: "panel" }); panel.append(summary, scroll);
    out.replaceChildren(panel);
    out.hidden = false;
    // Count up to the result for a little feedback (skipped when reduced motion is preferred).
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      let n = 0; const total = rows.length;
      const tick = () => { big.textContent = `${n} of ${total} within the budget rule`; if (n++ < valid) setTimeout(tick, 90); };
      tick();
    }
  }

  async function runAudit(event) {
    event?.preventDefault();
    const out = $("auditStatus");
    const receipts = parseReceipts($("auditInput").value);
    if (!receipts.length) return status(out, "Paste proof links or proof files first, or select “Create an example round”.", "fail");
    status(out, `Checking ${receipts.length} proof${receipts.length === 1 ? "" : "s"}…`);
    try { renderAudit(await auditReceipts(receipts)); $("auditPlaceholder").hidden = true; status(out, "Check complete.", "pass"); }
    catch (error) { status(out, `Audit failed: ${error.message}`, "fail"); }
  }

  // Demo round: real proofs for random in-range budgets, plus one tampered and one reused receipt.
  // Demo receipts are not sent to zkVerify, to save the shared relay quota.
  async function demoRound() {
    const out = $("auditStatus"), button = $("auditDemo");
    button.disabled = true;
    status(out, "Creating budget proofs for 5 example applicants in your browser…");
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
  $("zkUseCurrent").addEventListener("click", () => { if (current) { $("zkVerifyInput").value = JSON.stringify(current.receipt, null, 2); verify(); } else status($("zkVerifyStatus"), "Create a proof first.", "fail"); });
  window.addEventListener("hashchange", loadSharedReceipt);
  loadSharedReceipt();
})();
