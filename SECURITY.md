# Security policy

Report vulnerabilities privately through GitHub's **Security → Report a vulnerability**. If that is unavailable, open an issue asking for a private contact channel, without posting vulnerability details.

Include affected versions, expected and observed behaviour, and reproduction steps using sample data. Keep credentials and real applicant data out of reports.

## Secrets

These are server-side environment variables and are never committed: `GEMINI_API_KEY`, `KURIER_API_KEY`, `AGENT_GAMES_HMAC_SECRET`. The browser never receives them.

## Trust boundaries

- The budget never leaves the applicant's browser. Only a Groth16 proof and a Poseidon commitment are sent.
- Application text is sent to the server and to Google Gemini with amounts replaced by `[AMOUNT]`, in the browser and again on the server. It is not stored.
- Model output is untrusted. It is validated against the known rule IDs and verdicts and rendered as text, never as HTML.
- Public endpoints (`/api/screen`, `/api/attest`, `/api/agent/check`) are rate-limited per IP. `/api/attest` re-verifies each proof before relaying it to zkVerify.
- `/api/agent` requires a valid HMAC-SHA256 signature (`x-agent-games-signature`) and signs its responses.
