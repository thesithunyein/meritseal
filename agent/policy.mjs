import { readFile } from "node:fs/promises";
import { screenApplication } from "./screen.mjs";

export const NLNET_POLICY_ID = "nlnet-first-grant-amount:v1";
const ZK_DIR = new URL("./public/zk/", import.meta.url);
const FIELD_ELEMENT = /^[0-9]{1,78}$/;

export function evaluateNlnetAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("Enter a positive whole-euro amount.");
  return amount >= 5000 && amount <= 50000;
}

export function evaluateRules(policy, application) {
  for (const rule of policy.rules) {
    const actual = application[rule.field];
    const expected = rule.value;
    const passes = (rule.operator === "equals" && actual === expected)
      || (rule.operator === "not_equals" && actual !== expected)
      || (rule.operator === "gte" && Number(actual) >= Number(expected))
      || (rule.operator === "lte" && Number(actual) <= Number(expected))
      || (rule.operator === "includes" && Array.isArray(actual) && actual.includes(expected));
    if (!passes) return { decision: "REJECT", reason_code: "POLICY_CHECK_FAILED", failed_rule: rule.id ?? rule.field };
  }
  return { decision: "APPROVE", reason_code: "POLICY_CHECKS_PASSED" };
}

// Shape check before any cryptography: one public signal (the commitment) and a snarkjs Groth16 proof.
export function parseZkReceipt(receipt) {
  const proof = receipt?.proof;
  const signals = receipt?.public_signals ?? receipt?.publicSignals;
  const point = (p, n) => Array.isArray(p) && p.length >= n && p.slice(0, n).every(v => typeof v === "string" && FIELD_ELEMENT.test(v));
  const ok = proof && typeof proof === "object"
    && point(proof.pi_a, 2) && Array.isArray(proof.pi_b) && proof.pi_b.length >= 2 && proof.pi_b.slice(0, 2).every(row => point(row, 2)) && point(proof.pi_c, 2)
    && Array.isArray(signals) && signals.length === 1 && typeof signals[0] === "string" && FIELD_ELEMENT.test(signals[0]);
  if (!ok) return null;
  return { proof: { pi_a: proof.pi_a, pi_b: proof.pi_b, pi_c: proof.pi_c, protocol: "groth16", curve: "bn128" }, publicSignals: [signals[0]] };
}

let verifierPromise;
// Loads snarkjs and the published verification key once. Resolves to null when either is missing,
// so the agent fails closed instead of approving.
export function loadVerifier() {
  verifierPromise ??= (async () => {
    try {
      const [{ groth16 }, vkeyRaw] = await Promise.all([import("snarkjs"), readFile(new URL("vkey.json", ZK_DIR), "utf8")]);
      const vkey = JSON.parse(vkeyRaw);
      return { vkey, verify: (proof, publicSignals) => groth16.verify(vkey, publicSignals, proof) };
    } catch {
      return null;
    }
  })();
  return verifierPromise;
}

export async function verifyZkReceipt(receipt, verifier) {
  const parsed = parseZkReceipt(receipt);
  if (!parsed) return { decision: "REJECT", reason_code: "INVALID_RECEIPT" };
  const v = verifier ?? await loadVerifier();
  if (!v) return { decision: "REJECT", reason_code: "VERIFIER_UNAVAILABLE" };
  let valid = false;
  try { valid = await v.verify(parsed.proof, parsed.publicSignals); } catch { valid = false; }
  return valid
    ? { decision: "APPROVE", reason_code: "ZK_PROOF_VALID", commitment: parsed.publicSignals[0] }
    : { decision: "REJECT", reason_code: "ZK_PROOF_INVALID" };
}

// Full screening: Gemini assesses the (redacted) application against NLnet's rules and the budget
// rule is satisfied only by a valid zero-knowledge receipt. APPROVE needs both.
export async function screenAndDecide(input, verifier, screen = screenApplication) {
  const [assessment, budget] = await Promise.all([
    screen(input.application_text),
    input.receipt ? verifyZkReceipt(input.receipt, verifier) : Promise.resolve({ decision: "REJECT", reason_code: "BUDGET_PROOF_MISSING" })
  ]);
  const budgetOk = budget.reason_code === "ZK_PROOF_VALID";
  const approve = assessment.overall === "READY" && budgetOk;
  const reason_code = approve ? "SCREEN_PASSED" : !budgetOk ? budget.reason_code : assessment.overall === "NOT_READY" ? "SCREEN_NOT_READY" : "SCREEN_NEEDS_WORK";
  return { decision: approve ? "APPROVE" : "REJECT", reason_code, budget: { ...budget }, assessment };
}

export async function decide(task, verifier) {
  const input = task.input ?? {};
  if (typeof input.application_text === "string") {
    try { return await screenAndDecide(input, verifier); }
    catch (error) { return { decision: "REJECT", reason_code: "SCREENING_UNAVAILABLE", detail: String(error.message).slice(0, 60) }; }
  }
  if (input.policy_id === NLNET_POLICY_ID) {
    // Preferred path: the applicant sends a zero-knowledge receipt; the agent never sees the amount.
    if (input.receipt || input.proof) return verifyZkReceipt(input.receipt ?? input, verifier);
    try {
      const passes = evaluateNlnetAmount(input.amount_eur);
      return { decision: passes ? "APPROVE" : "REJECT", reason_code: passes ? "AMOUNT_IN_RANGE" : "AMOUNT_OUT_OF_RANGE" };
    } catch {
      return { decision: "REJECT", reason_code: "INVALID_AMOUNT" };
    }
  }
  if (!input.policy || !input.application || !Array.isArray(input.policy.rules)) {
    return { decision: "REJECT", reason_code: "UNSUPPORTED_TASK" };
  }
  return evaluateRules(input.policy, input.application);
}
