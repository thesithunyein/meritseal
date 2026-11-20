import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
process.env.AGENT_GAMES_HMAC_SECRET="test-secret";
const {createAgentServer}=await import("./server.mjs");
async function call(server,payload,signature){const raw=JSON.stringify(payload);const response=await fetch(`http://127.0.0.1:${server.address().port}/agent`,{method:"POST",headers:{"content-type":"application/json","x-agent-games-signature":signature??createHmac("sha256","test-secret").update(raw).digest("hex")},body:raw});return{response,body:await response.json()}}
test("responds to a signed preflight",async()=>{const server=createAgentServer().listen(0);const result=await call(server,{type:"agent-games.preflight.v1",agent_id:"agt_test",nonce:"n"});assert.equal(result.response.status,200);assert.deepEqual(result.body,{ok:true,protocolVersion:"v1"});assert.ok(result.response.headers.get("x-agent-games-signature"));server.close()});
test("fails closed on unsigned traffic",async()=>{const server=createAgentServer().listen(0);const result=await call(server,{task_id:"bad",input:{}},"wrong");assert.equal(result.response.status,401);server.close()});
test("evaluates a signed policy task",async()=>{const server=createAgentServer().listen(0);const task={task_id:"policy-1",input:{policy:{rules:[{id:"budget",field:"budget",operator:"lte",value:5000}]},application:{budget:4200}}};const result=await call(server,task);assert.equal(result.body.decision,"APPROVE");server.close()});
test("signs NLnet decisions at both boundaries", async (t) => {
  const server = createAgentServer().listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise(resolve => server.once("listening", resolve));
  for (const [amount, decision, reason] of [
    [4999, "REJECT", "AMOUNT_OUT_OF_RANGE"],
    [5000, "APPROVE", "AMOUNT_IN_RANGE"],
    [50000, "APPROVE", "AMOUNT_IN_RANGE"],
    [50001, "REJECT", "AMOUNT_OUT_OF_RANGE"]
  ]) {
    const raw = JSON.stringify({ task_id: `nlnet-${amount}`, input: {
      policy_id: "nlnet-first-grant-amount:v1", amount_eur: amount
    } });
    const sign = body => createHmac("sha256", "test-secret").update(body).digest("hex");
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/agent`, {
      method: "POST", headers: { "x-agent-games-signature": sign(raw) }, body: raw
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-agent-games-signature"), sign(body));
    assert.equal(JSON.parse(body).decision, decision);
    assert.equal(JSON.parse(body).reason_code, reason);
  }
});


