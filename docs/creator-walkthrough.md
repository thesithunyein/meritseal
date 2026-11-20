# MeritSeal · Private grant eligibility receipts

Grant reviewers need a way to share the outcome of an eligibility check without sharing the underlying application. MeritSeal's public workspace shows that workflow with an illustrative whole-dollar request cap of $5,000.

## Walkthrough

1. Open [MeritSeal](https://meritseal.vercel.app/#review). Run the $4,200 example and show the eligible result.
2. Copy the receipt into the checker. It contains a policy ID, decision, issuance time, and SHA-256 checksum. The amount stays in the browser.
3. Change the decision from Eligible to Ineligible in the checker while leaving the checksum intact. The check should fail.
4. Run the $6,000 example and show that the policy rejects it.
5. Explain the verification boundary. A checksum detects edits relative to the original checksum. Anyone can compute a replacement. The live receipt has no issuer signature or zero-knowledge proof.

## Architecture

The public workspace evaluates the illustrative policy in the browser. Separately, the HTTPS agent handles signed Agent Games requests and evaluates explicit policy rules. The workspace does not call the private agent endpoint. The signed callback and browser flow serve different audiences.

A future proof would bind the policy version, cap, outcome, and a commitment to the hidden amount. An independent verifier could then check whether the committed amount satisfies the cap. Include a network verification reference only once a real proof has been verified.

## Recording outline

Spend 15 seconds on the reviewer problem, 30 seconds running both outcomes, 20 seconds showing the receipt and edit check, and 15 seconds explaining what an independent proof would add.
