# NLnet first-grant amount proof

The circuit binds a private whole-euro amount to one public Poseidon commitment and enforces the inclusive €5,000–€50,000 range from [NLnet's application form](https://nlnet.nl/propose/). Verification establishes only this amount criterion. The verifying key identifies this circuit and policy version. Keep the amount, salt, and witness private.

## Local development

With Circom 2.1.6+ and Node installed, install the proof dependencies in the repository with `npm install --no-save --package-lock=false circomlib circomlibjs snarkjs`. Use synthetic amounts during development.

```bash
mkdir -p proof/build
circom proof/nlnet-amount.circom -l node_modules --r1cs --wasm -o proof/build
node proof/example-input.mjs 12000 > proof/build/private-input.json
node proof/build/nlnet-amount_js/generate_witness.js proof/build/nlnet-amount_js/nlnet-amount.wasm proof/build/private-input.json proof/build/witness.wtns
```

Use a trusted Powers of Tau phase-2 file large enough for the circuit and a reviewed circuit-specific Groth16 ceremony. Export its verification key, prove with the final zkey, and verify locally using snarkjs. A development setup with public entropy is suitable only for testing. Never publish the input JSON or witness, and do not reuse the salt across requests.

Test that €5,000 and €50,000 pass, €4,999 and €50,001 fail, and changing the public commitment invalidates a passing proof. The assertion that the amount falls in range is fixed in this circuit, so a receipt verifier should derive the passing outcome from successful proof verification and reject contradictory receipt text.

## Network verification

Follow the [zkVerify quickstart](https://docs.zkverify.io/handbook/quickstart) with the Groth16 proof, verification key, and public signals. Kurier requires a testnet API key. The direct route requires a funded network account. Publish the finalized verification reference only after confirming it corresponds to this circuit and commitment.

Status: circuit source and input helper only. No finalized network proof is referenced here.
