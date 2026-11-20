const form = document.getElementById('policyForm');
const result = document.getElementById('receiptResult');
const empty = document.getElementById('emptyState');
const clearAll = document.getElementById('clearAll');
const storageKey = 'meritseal-last-receipt';

function clean(value) { return value.trim().replace(/\s+/g, ' '); }
function escapeHTML(value) { const el = document.createElement('div'); el.textContent = value; return el.innerHTML; }
async function digest(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join(''); }
async function issueReceipt(data) {
  const receipt = { policy: clean(data.policyName), version: clean(data.policyVersion), decision: clean(data.decision), checks: data.checks.split('\n').map(clean).filter(Boolean), issuedAt: new Date().toISOString() };
  receipt.hash = await digest(JSON.stringify(receipt));
  localStorage.setItem(storageKey, JSON.stringify(receipt));
  renderReceipt(receipt);
}
function renderReceipt(receipt) {
  empty.hidden = true; result.hidden = false;
  const checks = receipt.checks.map(c => `<li>${escapeHTML(c)}</li>`).join('');
  result.innerHTML = `<article class="issued-receipt"><span class="result-label">Receipt issued locally</span><h3>${escapeHTML(receipt.policy)}</h3><div class="result-row"><span>Decision</span><b>${escapeHTML(receipt.decision)}</b></div><div class="result-row"><span>Policy version</span><b>${escapeHTML(receipt.version)}</b></div><div class="result-row"><span>Issued</span><b>${new Date(receipt.issuedAt).toLocaleString()}</b></div><div class="result-checks"><span>Checks recorded</span><ul>${checks}</ul></div><div class="result-row"><span>Receipt hash</span><code>${receipt.hash}</code></div><button class="button quiet copy-button" id="copyReceipt" type="button">Copy receipt</button><p class="toast" id="toast" hidden>Receipt copied.</p></article>`;
  document.getElementById('copyReceipt').addEventListener('click', async () => { await navigator.clipboard.writeText(JSON.stringify(receipt, null, 2)); document.getElementById('toast').hidden = false; });
}
form.addEventListener('submit', async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); await issueReceipt(data); document.getElementById('receiptResult').scrollIntoView({behavior:'smooth',block:'center'}); });
clearAll.addEventListener('click', () => { localStorage.removeItem(storageKey); form.reset(); document.getElementById('policyVersion').value='v1.0'; result.hidden=true; empty.hidden=false; });
try { const saved = JSON.parse(localStorage.getItem(storageKey)); if (saved) renderReceipt(saved); } catch { localStorage.removeItem(storageKey); }

