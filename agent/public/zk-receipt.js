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

  async function anchor(receipt) {
    try {
      const res = await fetch("/api/attest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof: receipt.proof, public_signals: receipt.public_signals }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { receipt.zkverify = { network: "zkVerify Volta testnet", status: res.status === 503 ? "Relay not configured" : `Relay error (${body.error ?? res.status})` }; return renderReceipt(); }
      receipt.zkverify = { network: "zkVerify Volta testnet", job_id: body.job_id, vk_hash: body.vk_hash, status: "Queued" };
      renderReceipt();
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const s = await fetch(`/api/attest/${encodeURIComponent(body.job_id)}`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (!s) continue;
        Object.assign(receipt.zkverify, { status: s.status, tx_hash: s.tx_hash, explorer_url: s.explorer_url });
        renderReceipt();
        if (DONE.has(s.status)) break;
      }
    } catch {
      receipt.zkverify = { network: "zkVerify Volta testnet", status: "Relay unreachable" };
      renderReceipt();
    }
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
      const [snarkjs, key] = await Promise.all([loadSnarkjs(), loadKey()]);
      const opening = { policy_id: POLICY_ID, amount: raw, salt: randomSalt() };
      let proved;
      try {
        proved = await snarkjs.groth16.fullProve({ amount: opening.amount, salt: opening.salt }, ZK + "nlnet-amount.wasm", ZK + "nlnet-amount.zkey");
      } catch {
        return status(out, `No proof exists for €${Number(raw).toLocaleString("en")}: the circuit only accepts amounts from €5,000 to €50,000. Nothing was sent.`, "fail");
      }
      if (!await snarkjs.groth16.verify(key.vkey, proved.publicSignals, proved.proof)) throw new Error("Local verification failed");
      const receipt = {
        type: RECEIPT_TYPE, policy_id: POLICY_ID,
        statement: "The committed whole-euro amount is between €5,000 and €50,000 inclusive.",
        commitment: proved.publicSignals[0], public_signals: proved.publicSignals, proof: proved.proof,
        vkey_sha256: key.sha256, issued_at: new Date().toISOString(), zkverify: null
      };
      opening.commitment = receipt.commitment;
      current = { receipt, opening };
      status(out, "Proof generated and verified. Sending proof (not the amount) to zkVerify…", "pass");
      renderReceipt();
      anchor(receipt);
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

  $("zkForm").addEventListener("submit", prove);
  $("zkVerifyForm").addEventListener("submit", verify);
  for (const btn of document.querySelectorAll("[data-zk-amount]")) btn.addEventListener("click", () => { $("zkAmount").value = btn.dataset.zkAmount; $("zkForm").requestSubmit(); });
  $("zkUseCurrent").addEventListener("click", () => { if (current) { $("zkVerifyInput").value = JSON.stringify(current.receipt, null, 2); verify(); } else status($("zkVerifyStatus"), "Generate a receipt first.", "fail"); });
  window.addEventListener("hashchange", loadSharedReceipt);
  loadSharedReceipt();
})();
