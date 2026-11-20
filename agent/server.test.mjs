import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
process.env.AGENT_GAMES_HMAC_SECRET="test-secret";
const {createAgentServer}=await import("./server.mjs");
async function call(server,payload,signature){const raw=JSON.stringify(payload);const response=await fetch(`http://127.0.0.1:${server.address().port}/agent`,{method:"POST",headers:{"content-type":"application/json","x-agent-games-signature":signature??createHmac("sha256","test-secret").update(raw).digest("hex")},body:raw});return{response,body:await response.json()}}
test("responds to a signed preflight",async()=>{const server=createAgentServer().listen(0);const result=await call(server,{type:"agent-games.preflight.v1",agent_id:"agt_test",nonce:"n"});assert.equal(result.response.status,200);assert.deepEqual(result.body,{ok:true,protocolVersion:"v1"});assert.ok(result.response.headers.get("x-agent-games-signature"));server.close()});
test("fails closed on unsigned traffic",async()=>{const server=createAgentServer().listen(0);const result=await call(server,{task_id:"bad",input:{}},"wrong");assert.equal(result.response.status,401);server.close()});
test("evaluates a signed policy task",async()=>{const server=createAgentServer().listen(0);const task={task_id:"policy-1",input:{policy:{rules:[{id:"budget",field:"budget",operator:"lte",value:5000}]},application:{budget:4200}}};const result=await call(server,task);assert.equal(result.body.decision,"APPROVE");server.close()});

