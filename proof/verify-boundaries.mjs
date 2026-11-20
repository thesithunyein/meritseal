import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPoseidon } from "circomlibjs";
import { groth16, wtns } from "snarkjs";

const base = "proof/build/";
const wasm = process.argv[2] ?? base + "nlnet-amount_js/nlnet-amount.wasm";
const key = JSON.parse(await readFile(base + "dev.vkey.json", "utf8"));
const poseidon = await buildPoseidon();

function inputFor(amount) {
  // Fixed salt for synthetic test inputs only.
  const commitment = poseidon.F.toObject(poseidon([1n, amount, 42n]));
  return { amount: String(amount), salt: "42", commitment: String(commitment) };
}

try {
  for (const amount of [5000n, 50000n]) {
    const input = inputFor(amount);
    const { proof, publicSignals } = await groth16.fullProve(input, wasm, base + "dev.zkey");
    assert.deepEqual(publicSignals, [input.commitment]);
    assert.equal(await groth16.verify(key, publicSignals, proof), true);
    const changed = inputFor(amount + 1n).commitment;
    assert.equal(await groth16.verify(key, [changed], proof), false);
    console.log(`${amount}: proof verified; modified commitment rejected`);
  }
  for (const amount of [4999n, 50001n]) {
    await assert.rejects(wtns.calculate(inputFor(amount), wasm, { type: "mem" }), /Assert Failed|Error in template/i);
    console.log(`${amount}: witness rejected`);
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
process.exit(0);

