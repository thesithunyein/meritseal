// Regression check for the production artifacts in agent/public/zk/ (run after proof/setup.mjs).
// €5,000 and €50,000 must prove and verify; €4,999 and €50,001 must be impossible to prove;
// a proof must not verify against a different commitment.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { groth16 } from "snarkjs";

const dir = "agent/public/zk/";
const vkey = JSON.parse(await readFile(dir + "vkey.json", "utf8"));
const salt = () => BigInt("0x" + randomBytes(31).toString("hex")).toString();

try {
  for (const amount of [5000, 12000, 50000]) {
    const { proof, publicSignals } = await groth16.fullProve({ amount: String(amount), salt: salt() }, dir + "nlnet-amount.wasm", dir + "nlnet-amount.zkey");
    assert.equal(publicSignals.length, 1);
    assert.equal(await groth16.verify(vkey, publicSignals, proof), true);
    const tampered = [(BigInt(publicSignals[0]) + 1n).toString()];
    assert.equal(await groth16.verify(vkey, tampered, proof), false);
    console.log(`€${amount}: proof verified; tampered commitment rejected`);
  }
  for (const amount of [4999, 50001, 70000]) {
    await assert.rejects(groth16.fullProve({ amount: String(amount), salt: salt() }, dir + "nlnet-amount.wasm", dir + "nlnet-amount.zkey"));
    console.log(`€${amount}: no proof possible (outside range)`);
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
process.exit(0);
