<p align="center"><img src="./docs/meritseal-shield.svg" width="82" height="82" alt="MeritSeal shield"></p>

<h1 align="center">MeritSeal</h1>
<p align="center">Zero-knowledge grant receipts: prove a funding request follows the rule without revealing the budget.</p>

<p align="center">
  <a href="https://meritseal.vercel.app/#zk"><img src="https://img.shields.io/badge/Live-Create%20a%20ZK%20receipt-283A8C" alt="Create a ZK receipt"></a>
  <a href="./docs/creator-walkthrough.md"><img src="https://img.shields.io/badge/Read-Technical%20walkthrough-475569" alt="Technical walkthrough"></a>
</p>

[![MeritSeal landing page](./docs/meritseal-home.png)](https://meritseal.vercel.app/)

## The problem

Grant programs (foundations, DAOs, public-goods funds) are asked to show that every request and award follows their published rules. The obvious way to show that is to publish each budget, but grantees often can't do that: budgets reveal salaries, rates and runway. Today programs pick one side: they publish everything, or they ask the public to trust them.

MeritSeal lets an applicant **prove** a rule holds without disclosing the number. The first rule is NLnet's published first-grant range: the requested amount must be €5,000–€50,000 ([NLnet application form](https://nlnet.nl/propose/)).

**Who it helps:**
- **Applicants** prove their request is in range to a screening agent or a public reviewer without revealing their budget.
- **Grant programs and auditors** check a whole round's receipts and confirm each one is in policy, without seeing any amounts.

## Try it in under a minute

1. Open **[meritseal.vercel.app/#zk](https://meritseal.vercel.app/#zk)** and select **Try €12,000**. Your browser generates a Groth16 proof (a few seconds). The amount is never sent anywhere.
2. The receipt shows the policy, a Poseidon commitment and the proof, then the zkVerify status as the proof is verified on-chain (Queued → … → Finalized, with a Subscan link).
3. Select **Copy receipt link** and open it in another browser. The proof is verified there against the published key, and the amount appears nowhere.
4. Select **Try €55,000**. No proof can be generated, because the circuit rejects out-of-range amounts.
5. Edit any digit of the proof or commitment in **Check a receipt** → **Invalid**.

## How it works

```mermaid
flowchart LR
    subgraph Browser["Applicant's browser (amount never leaves)"]
        A["Amount + random salt"] --> P["Groth16 prover<br/>circuit: 5,000 ≤ amount ≤ 50,000<br/>commitment = Poseidon(1, amount, salt)"]
    end
    P -->|"proof + commitment only"| R["MeritSeal receipt"]
    R --> V1["Anyone: verify in browser<br/>against published vkey"]
    R --> S["/api/attest<br/>re-verifies, rate-limited"]
    S --> K["Kurier relayer"] --> Z["zkVerify Volta<br/>on-chain Groth16 verification"]
    R --> AG["MeritSeal agent<br/>Agent Games task → APPROVE / REJECT"]
```

- **Circuit** (`proof/nlnet-amount.circom`): private `amount` and `salt`; public output `commitment`. It constrains the amount to 16 bits, then `5000 ≤ amount ≤ 50000`. The commitment lets the applicant later open the exact amount to the funder (the "private opening" file) while nobody else learns it.
- **Receipt** (`meritseal.zk-receipt.v2`): `policy_id`, `commitment`, `proof`, `public_signals`, `vkey_sha256`, `issued_at`, and zkVerify `job_id` / `tx_hash`. The "in range" result comes from the proof itself. No field of the receipt is trusted text.
- **zkVerify**: the server re-verifies each proof locally (so junk never reaches the relay), registers the verification key once, submits via Kurier, and returns the job status and transaction hash.
- **Key transparency**: `/zk/manifest.json` publishes the circuit, the verification-key SHA-256 and how the key was generated. Receipts made under a different key are rejected.

## The agent

`POST /api/agent` is an [Agent Games](https://agentgames.zkverify.io) endpoint: HMAC-signed requests and responses, idempotent task IDs, deadline handling and preflight.

| Task input | Decision |
| --- | --- |
| `{ policy_id: "nlnet-first-grant-amount:v1", receipt: { proof, public_signals } }` | Verifies the Groth16 proof and returns `APPROVE / ZK_PROOF_VALID` plus the commitment. **It never sees the amount.** |
| `{ policy_id: "nlnet-first-grant-amount:v1", amount_eur }` | Plain range check (`AMOUNT_IN_RANGE` / `AMOUNT_OUT_OF_RANGE`) |
| `{ policy: { rules }, application }` | Generic versioned rule evaluation (`equals`, `gte`, `lte`, `includes`, …) |

It fails closed: malformed receipts → `INVALID_RECEIPT`; a missing verifier or key → `VERIFIER_UNAVAILABLE`; bad signatures → 401.

## Run locally

Requires Node 20+ and [circom 2.1.6+](https://docs.circom.io/getting-started/installation/).

```bash
npm install
npm run zk:setup      # compile circuit, Groth16 setup, write agent/public/zk/*
npm run zk:check      # €5,000/€12,000/€50,000 prove & verify; €4,999/€50,001/€70,000 cannot prove; tampering rejected
npm test              # agent, signing, receipt handling, static serving
cp .env.example .env  # AGENT_GAMES_HMAC_SECRET, KURIER_API_KEY
npm start             # http://localhost:3000
```

Deployed as a container (`Dockerfile`). Health: `GET /api/health` reports `secretConfigured`, `zkVerifierLoaded` and `attestationConfigured`.

## Limitations

- One criterion only. NLnet decides eligibility and awards. MeritSeal proves the amount rule, not the merit of a proposal.
- The Groth16 key comes from a single-party setup (details in `/zk/manifest.json`). A production deployment should run a multi-party phase-2 ceremony.
- A receipt proves the *committed* amount is in range. Binding that commitment to the amount in the actual application is the funder's step, done with the private opening.
- zkVerify submission uses the Volta testnet.

## Project policies

[Security](./SECURITY.md) · [Code of conduct](./CODE_OF_CONDUCT.md) · [MIT license](./LICENSE)
