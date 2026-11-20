import { createHmac, timingSafeEqual } from "node:crypto";

const completed = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;
const secret = () => process.env.AGENT_GAMES_HMAC_SECRET ?? "";
const sign = (raw) => createHmac("sha256", secret()).update(raw).digest("hex");

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (secret()) res.setHeader("x-agent-games-signature", sign(raw));
  res.end(raw);
}

async function rawBody(req) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error("too_large");
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

function validSignature(raw, supplied = "") {
  const got = supplied.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = sign(raw);
  return Boolean(got) && got.length === expected.length &&
    timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}

function decide(task) {
  const policy = task.input?.policy;
  const application = task.input?.application;
  if (!policy || !application || !Array.isArray(policy.rules)) {
    return { decision: "REJECT", reason_code: "UNSUPPORTED_TASK" };
  }
  for (const rule of policy.rules) {
    const actual = application[rule.field];
    const expected = rule.value;
    const passes = (rule.operator === "equals" && actual === expected)
      || (rule.operator === "not_equals" && actual !== expected)
      || (rule.operator === "gte" && Number(actual) >= Number(expected))
      || (rule.operator === "lte" && Number(actual) <= Number(expected))
      || (rule.operator === "includes" && Array.isArray(actual) && actual.includes(expected));
    if (!passes) return { decision: "REJECT", reason_code: "POLICY_CHECK_FAILED", failed_rule: rule.id ?? rule.field };
  }
  return { decision: "APPROVE", reason_code: "POLICY_CHECKS_PASSED" };
}

function prune() {
  const now = Date.now();
  for (const [id, entry] of completed) if (now - entry.savedAt > TTL_MS) completed.delete(id);
}

export const config = { api: { bodyParser: false }, maxDuration: 10 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("allow", "POST");
    return res.end();
  }
  if (!secret()) return send(res, 503, { error: "secret_not_configured" });

  let raw;
  try { raw = await rawBody(req); } catch { return send(res, 413, { error: "payload_too_large" }); }
  if (!validSignature(raw, req.headers["x-agent-games-signature"])) return send(res, 401, { error: "invalid_signature" });

  let task;
  try { task = JSON.parse(raw); } catch { return send(res, 400, { error: "invalid_json" }); }
  if (task.type === "agent-games.preflight.v1") return send(res, 200, { ok: true, protocolVersion: "v1" });

  const deadline = task.deadline_at ?? task.deadlineAt;
  if (deadline && Number.isFinite(Date.parse(deadline)) && Date.now() > Date.parse(deadline)) {
    return send(res, 408, { decision: "REJECT", reason_code: "DEADLINE_EXPIRED" });
  }
  const taskId = task.task_id ?? task.taskId;
  if (!taskId || typeof taskId !== "string") return send(res, 400, { error: "missing_task_id" });

  prune();
  const cached = completed.get(taskId);
  if (cached) return send(res, 200, cached.body);
  const body = { task_id: taskId, ...decide(task), agent: "meritseal", protocolVersion: "v1" };
  completed.set(taskId, { body, savedAt: Date.now() });
  return send(res, 200, body);
}
