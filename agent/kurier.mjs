// Minimal Kurier (zkVerify relayer) client: register-vk → submit-proof → job-status.
// Docs: https://docs.zkverify.io/overview/getting-started/kurier
const apiUrl = () => (process.env.KURIER_API_URL ?? "https://api-testnet.kurier.xyz/api/v1").replace(/\/$/, "");
const apiKey = () => process.env.KURIER_API_KEY ?? "";
const PROOF_OPTIONS = { library: "snarkjs", curve: "bn128" };
export const EXPLORER = process.env.ZKVERIFY_EXPLORER ?? "https://zkverify-testnet.subscan.io/extrinsic/";

export const kurierConfigured = () => Boolean(apiKey());

async function call(path, init) {
  const response = await fetch(`${apiUrl()}/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 200) }; }
  return { ok: response.ok, status: response.status, body };
}

let vkHashPromise;
// Registers the verification key once per process. Kurier returns the existing hash when the key
// is already registered. KURIER_VK_HASH skips the call entirely.
export function vkHash(vkey) {
  if (process.env.KURIER_VK_HASH) return Promise.resolve(process.env.KURIER_VK_HASH);
  vkHashPromise ??= call(`register-vk/${apiKey()}`, {
    method: "POST",
    body: JSON.stringify({ proofType: "groth16", proofOptions: PROOF_OPTIONS, vk: vkey })
  }).then(({ body }) => {
    const hash = body.vkHash ?? body.meta?.vkHash;
    if (!hash) throw new Error("vk_registration_failed");
    return hash;
  }).catch(error => { vkHashPromise = undefined; throw error; });
  return vkHashPromise;
}

export async function submitProof(vkey, proof, publicSignals) {
  const hash = await vkHash(vkey);
  const { ok, status, body } = await call(`submit-proof/${apiKey()}`, {
    method: "POST",
    body: JSON.stringify({ proofType: "groth16", vkRegistered: true, proofOptions: PROOF_OPTIONS, proofData: { proof, publicSignals, vk: hash } })
  });
  if (!ok || !body.jobId) throw new Error(`submit_failed_${status}`);
  return { job_id: body.jobId, optimistic_verify: body.optimisticVerify ?? null, vk_hash: hash };
}

export async function jobStatus(jobId) {
  const { ok, status, body } = await call(`job-status/${apiKey()}/${jobId}`, { method: "GET" });
  if (!ok) throw new Error(`status_failed_${status}`);
  return {
    job_id: jobId,
    status: body.status ?? "Unknown",
    tx_hash: body.txHash ?? null,
    block_hash: body.blockHash ?? null,
    explorer_url: body.txHash ? EXPLORER + body.txHash : null
  };
}
