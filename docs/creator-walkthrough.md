# MeritSeal reviewer walkthrough

A grant reviewer can share the result of an amount check without sharing the requested budget. MeritSeal applies [NLnet’s published €5,000–€50,000 range for first grant requests](https://nlnet.nl/propose/) in the browser. This checks one criterion. NLnet determines overall eligibility and awards.

## Try the receipt handoff

Open the [live checker](https://meritseal.vercel.app/#review), try **€12,000**, and select **Open receipt**. To see the recipient experience in a separate browser, select **Copy receipt link** and open the copied URL there. It shows the rule, result, date, and checksum status. The link and receipt omit the requested amount. Raw JSON is under **Technical details**.

Return to the checker and select **Use generated receipt**. Change `Within range` to `Outside range` while keeping the original checksum. Select **Check checksum** to see the mismatch. Then try **€55,000** for an out-of-range result. Select **Save receipt** to reopen it later from [Recent checks](https://meritseal.vercel.app/#history) in the same browser.

## What zkVerify checked

The [finalized Volta testnet transaction](https://zkverify-testnet.subscan.io/extrinsic/0xc480960248cd345a95f6b2b862d397445b475ed7a2c4149f54e12320bd5f29ea) shows a successful Groth16 verification for **one committed synthetic amount** within the published range. It used a development proving setup. The [live proof section](https://meritseal.vercel.app/#proof) links to that same transaction.

New browser receipts use SHA-256 checksums. Checking against the original checksum can detect edits. Issuer authentication and proof for each newly generated receipt remain outside this workflow.

## Agent and tests

The browser checker and signed callback use the same rule. The signed callback passed local tests for €4,999, €5,000, €50,000, and €50,001, including response HMAC checks. Production Agent Games preflight and practice remain unconfirmed. [Circuit and test results](../proof/README.md)

#AgentGames
