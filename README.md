# MeritSeal

Private eligibility receipts for grant programmes.

MeritSeal lets teams create a clear policy, evaluate it locally, and issue a tamper-evident receipt without putting private review details in the receipt.

## Local product UI

Open `dist/index.html` in a browser. This workspace stores its data only in the browser's local storage and does not collect applicant data.

## Agent endpoint

`agent/server.mjs` exposes `POST /agent` and `GET /health`.

- verifies `x-agent-games-signature` over the raw request body before parsing;
- signs every response with the HMAC secret;
- responds to Agent Games preflight;
- handles idempotent task retries; and
- evaluates explicit MeritSeal policy rules deterministically.

```bash
npm test
AGENT_GAMES_HMAC_SECRET=replace-me npm start
```

Never commit a real HMAC secret, wallet seed phrase, or API key. The memory cache is for local testing; production needs durable idempotency storage.
