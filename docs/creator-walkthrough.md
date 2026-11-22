# MeritSeal technical walkthrough

MeritSeal is an AI agent that checks a grant application against NLnet's published rules while the applicant's budget stays private. This walkthrough follows one application through the system. Everything here can be reproduced on the live site: https://meritseal.vercel.app.

## 1. The applicant pastes a proposal

On [#screen](https://meritseal.vercel.app/#screen), select **Use a strong example**, then **Check my application**. The text includes a budget breakdown with amounts such as "140 hours at €60/hour = €8,400". The total budget (€24,000) goes in a separate field.

Before anything is sent, the browser replaces every amount in the text with `[AMOUNT]` (`redactAmounts` in [`agent/public/zk-receipt.js`](../agent/public/zk-receipt.js)). The server repeats the same redaction ([`agent/screen.mjs`](../agent/screen.mjs)). Standard identifiers such as `RFC 4791` are kept, because the open-standards rule needs them. In the report, **What the AI saw** shows the exact text the model received.

## 2. The budget is proven, not sent

The browser builds a Groth16 proof with the circuit [`proof/nlnet-amount.circom`](../proof/nlnet-amount.circom):

- private inputs: `amount` (24000) and a random 248-bit `salt`
- constraints: `amount` fits in 16 bits, `5000 ≤ amount ≤ 50000`
- public output: `commitment = Poseidon(1, amount, salt)`

If the amount is out of range (try **Use a weak example**, €55,000), no witness exists, so no proof can be made and nothing is sent. The applicant can save a secret file (amount and salt) to later show a funder that the commitment matches the real budget.

## 3. The agent reads the application

`POST /api/screen` receives the redacted text and the proof. Gemini is asked to judge seven rules taken from [nlnet.nl/propose](https://nlnet.nl/propose/): technical development, open licence, open standards, budget breakdown, European dimension, written by a human, and plain English. For each rule it returns a verdict, a quote from the application and a reason.

The model's output is untrusted. `normalizeAssessment` keeps only the seven known rule IDs and the three verdicts (PASS, NEEDS_INFO, FAIL), so anything missing or invented becomes NEEDS_INFO, and the browser renders it as text only.

## 4. The agent decides

The agent verifies the Groth16 proof against the published verification key, then combines the two results ([`screenAndDecide`](../agent/policy.mjs)):

- all seven rules PASS **and** the proof verifies → `APPROVE / SCREEN_PASSED`
- otherwise → `REJECT` with `SCREEN_NEEDS_WORK`, `SCREEN_NOT_READY` or `BUDGET_PROOF_MISSING`

The report groups the checks into "Fix these first", "Add more detail" and "Already good", and adds one suggestion.

## 5. zkVerify records the budget proof

`POST /api/attest` re-verifies the proof on the server, then submits it to zkVerify Volta through Kurier ([`agent/kurier.mjs`](../agent/kurier.mjs)). The verification key is registered once at boot. The browser polls the job and shows "Recorded" and then "Confirmed", with a link to the transaction. Example finalized transaction: [0x8cbc2d54…16ba7afc](https://zkverify-testnet.subscan.io/extrinsic/0x8cbc2d54acf347b4f44f8878197930d841bfad845a6b0c3666d6941616ba7afc) (`settlementGroth16Pallet.submit_proof`, Success).

## 6. A grant program audits a round

On [#audit](https://meritseal.vercel.app/#audit), **Create an example round** generates five real proofs for random in-range budgets, then adds an altered proof and a reused one. The audit verifies each proof, flags reused commitments, and reports "5 of 7 within the budget rule" with only anonymous IDs shown.

## History

The first version (20 November 2026) issued SHA-256 checksum receipts for the amount check and verified one synthetic Groth16 proof on zkVerify ([transaction](https://zkverify-testnet.subscan.io/extrinsic/0xc480960248cd345a95f6b2b862d397445b475ed7a2c4149f54e12320bd5f29ea)). A checksum can show that a receipt was edited, but it can't show who issued it or prove the decision. That limitation is why every budget check now carries its own zero-knowledge proof, and why an AI agent was added for the rules that don't involve numbers.
