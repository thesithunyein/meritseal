export default function handler(_req, res) {
  const configured = Boolean(process.env.AGENT_GAMES_HMAC_SECRET);
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({ ok: true, service: "meritseal-agent", secretConfigured: configured }));
}
