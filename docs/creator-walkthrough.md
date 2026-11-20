# MeritSeal reviewer walkthrough

MeritSeal lets grant reviewers share an amount-check result while keeping the amount on their device. The app uses [NLnet’s published €5,000–€50,000 first-grant range](https://nlnet.nl/propose/). The check covers one criterion.

1. Open the [live checker](https://meritseal.vercel.app/#review). Try €12,000 and €55,000 for both outcomes.
2. Select **Open receipt** or copy the link into a separate browser. Read the rule, result, date, and checksum status.
3. Change one decision in the receipt checker while keeping the original checksum. Confirm the mismatch.
4. Open the [proof section](https://meritseal.vercel.app/#proof) and [finalized Volta testnet transaction](https://zkverify-testnet.subscan.io/extrinsic/0xc480960248cd345a95f6b2b862d397445b475ed7a2c4149f54e12320bd5f29ea). The Groth16 proof covers a committed synthetic amount and uses a development proving setup. It is separate from newly generated checksum receipts.

The browser and signed callback use the same amount rule. The callback passed local signed tests. Live Agent Games preflight and practice remain unconfirmed.

[Read the circuit and test results](../proof/README.md).
