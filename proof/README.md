# NLnet first-grant amount proof

`nlnet-amount.circom` proves that a private whole-euro `amount` is within NLnet's inclusive €5,000–€50,000 first-grant range ([NLnet application form](https://nlnet.nl/propose/)). It also outputs `commitment = Poseidon(1, amount, salt)` as the only public signal. The leading `1` is the policy version. Keep the amount, the salt and the witness private.

## Build the key and artifacts

```bash
npm install                       # snarkjs + circomlib
npm run zk:setup                  # local two-phase setup with fresh random entropy
# or: node proof/setup.mjs --ptau powersOfTau28_hez_final_12.ptau   (public phase-1 file)
npm run zk:check
```

`setup.mjs` writes `agent/public/zk/`: `nlnet-amount.wasm`, `nlnet-amount.zkey`, `vkey.json`, `snarkjs.min.js` and `manifest.json` (with the verification-key SHA-256). Commit these files. The browser proves with them and the server verifies with `vkey.json`. Re-running the setup creates a new key, and receipts made under the old key will no longer verify.

## What `zk:check` asserts

| Input | Expected |
| --- | --- |
| €5,000, €12,000, €50,000 | Proof generated and verified; a proof checked against a changed commitment fails |
| €4,999, €50,001, €70,000 | No witness, so no proof can be produced |

## zkVerify

`POST /api/attest` re-verifies a proof server-side, then submits it to zkVerify through Kurier (`register-vk` once, then `submit-proof` and `job-status`). It needs `KURIER_API_KEY`. The earlier sample transaction ([Subscan](https://zkverify-testnet.subscan.io/extrinsic/0xc480960248cd345a95f6b2b862d397445b475ed7a2c4149f54e12320bd5f29ea)) used the v1 development key. New receipts carry their own transaction.
