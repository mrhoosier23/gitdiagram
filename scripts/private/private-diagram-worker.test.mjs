// Standalone, network-free verification of the isolated private Worker.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../cloudflare/private-diagram-worker.js";
import { TEST as analysis } from "../../cloudflare/private-diagram-analysis.js";
const base="https://gitdiagram.awolverton.com";
const env={
 PRIVATE_INSTANCE_ENABLED:"1",
 PRIVATE_ALLOWED_EMAIL:"owner@example.test",
 PRIVATE_ACCESS_AUD:"test-aud",
 PRIVATE_MONTHLY_BUDGET_USD:"0",
 PRIVATE_OPENAI_CREDITS_ENABLED:"1"
};
const allow={access:{aud:"test-aud",getIdentity:async()=>({email:"Owner@Example.Test"})}};
function req(path,method,body,origin=base){
 return new Request(base+path,{method:method||"GET",headers:{"Origin":origin,"Sec-Fetch-Site":"same-origin",...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
}
test("Access denies anonymous and wrong-identity calls",async()=>{
 const a=await worker.fetch(req("/"),env,{});
 assert.equal(a.status,403);
 const b=await worker.fetch(req("/api/keys"),env,{access:{aud:"bad",getIdentity:async()=>({email:env.PRIVATE_ALLOWED_EMAIL})}});
 assert.equal(b.status,403);
 const c=await worker.fetch(req("/api/keys"),env,{access:{aud:"test-aud",getIdentity:async()=>({email:"other@example.test"})}});
 assert.equal(c.status,403);
 const d=await worker.fetch(req("/"),{...env,PRIVATE_INSTANCE_ENABLED:"0"},allow);
 assert.equal(d.status,403);
});
test("Owner sees private HTML without external scripts or leaked keys",async()=>{
 const response=await worker.fetch(req("/"),env,allow);
 assert.equal(response.status,200);
 const html=await response.text();
 assert.match(html,/GitDiagram/);
 assert.match(html,/Cloudflare Access/);
 assert.doesNotMatch(html,/__NONCE__/);
 assert.equal((html.match(/<script\b/g)||[]).length,1);
 assert.ok(!html.includes("src=\"https://"));
 assert.match(response.headers.get("content-security-policy"),/script-src 'nonce-/);
 assert.match(response.headers.get("cache-control"),/no-store/);
 assert.match(response.headers.get("x-robots-tag"),/noindex/);
});
test("The old protected access-check remains available",async()=>{
 const response=await worker.fetch(req("/__access-check"),env,allow);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{private:true,authenticated:true,mode:"private-app"});
});
test("Owner key entry writes HttpOnly cookies, never exposes the value",async()=>{
 const key="sk-"+("a".repeat(24));
 const response=await worker.fetch(req("/api/keys/openai","POST",{key}),env,allow);
 assert.equal(response.status,200);
 assert.equal((await response.text()).includes(key),false);
 const cookie=response.headers.get("set-cookie");
 assert.match(cookie,/__Host-gd_openai=/);
 assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);
 assert.equal(cookie.includes(key),true);
 const cleared=await worker.fetch(req("/api/keys/openai","DELETE"),env,allow);
 assert.equal(cleared.status,200);
 assert.match(cleared.headers.get("set-cookie"),/Max-Age=0/);
});
test("Rejects cross-origin token submission and invalid token",async()=>{
 const token="sk-"+("b".repeat(25));
 const cross=await worker.fetch(req("/api/keys/openai","POST",{key:token},"https://evil.example"),env,allow);
 assert.equal(cross.status,403);
 const bad=await worker.fetch(req("/api/keys/openai","POST",{key:"abc"}),env,allow);
 assert.equal(bad.status,400);
});
test("Repo parser rejects SSRF and malformed user input",()=>{
 assert.deepEqual(analysis.safeRepo("https://github.com/test-owner/test_repo"),{owner:"test-owner",repo:"test_repo"});
 for(const bad of ["http://127.0.0.1","https://other.example/x/y","foo/../bar","evil/evil?x=1","",null]){
  assert.throws(()=>analysis.safeRepo(bad));
 }
});
test("Graph output is constrained to known GitHub paths and safe Mermaid nodes",()=>{
 const paths=new Set(["src/main.ts"]);
 const graph=analysis.graphFromModel({summary:"A codebase",nodes:[
  {id:"core",label:"Core <script>",description:"A",path:"src/main.ts"},
  {id:"web",label:"Web",description:"B",path:"not-real.ts"}
 ],edges:[{from:"web",to:"core",label:"request"},{from:"core",to:"nonexistent",label:"skip"}]},{
  fullName:"user/repo",branch:"main",validPaths:paths,count:3
 });
 assert.equal(graph.nodes.length,2);
 assert.equal(graph.edges.length,1);
 assert.equal(graph.nodes[1].path,"");
 assert.ok(!graph.mermaid.includes("<script>"));
});
test("Generation uses the owner key only and never calls R2 or Redis",async()=>{
 const key="sk-"+("c".repeat(26));
 const input=new Request(base+"/api/diagram",{method:"POST",headers:{
  "Origin":base,"Sec-Fetch-Site":"same-origin","Content-Type":"application/json",
  "Cookie":"__Host-gd_openai="+encodeURIComponent(key)
 },body:JSON.stringify({repo:"sample/project"})});
 const calls=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  const u=String(url);calls.push(u);
  assert.equal(options.redirect,"manual","Cloudflare outbound fetch must explicitly reject redirects");
  if(u==="https://api.github.com/repos/sample/project")
   return Response.json({default_branch:"main",description:"Sample project"});
  if(u.startsWith("https://api.github.com/repos/sample/project/git/trees/"))
   return Response.json({tree:[{type:"blob",path:"src/index.ts",size:140},{type:"blob",path:"package.json",size:100}]});
  if(u.includes("/contents/")){
   const src=u.includes("package.json")?'{"name":"sample"}':"export function start() { return true; }";
   return Response.json({encoding:"base64",content:Buffer.from(src).toString("base64")});
  }
  if(u==="https://api.openai.com/v1/responses"){
   assert.equal(options.headers.Authorization,"Bearer "+key);
   const inputBody=JSON.parse(options.body);
   assert.equal(inputBody.model,"gpt-5-mini");
   assert.ok(JSON.stringify(inputBody).includes("src/index.ts"));
   const graph={summary:"Public entry and core",nodes:[
    {id:"entry",label:"Public entry",description:"Starts app",path:"src/index.ts"},
    {id:"core",label:"Application core",description:"Core config",path:"package.json"}
   ],edges:[{from:"entry",to:"core",label:"calls"}]};
   return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify(graph)}]}]});
  }
  throw new Error("Unexpected external request "+u);
 };
 try{
  const response=await worker.fetch(input,env,allow);
  assert.equal(response.status,200,await response.clone().text());
  const graph=await response.json();
  assert.equal(graph.repo,"sample/project");
  assert.equal(graph.nodes.length,2);
  assert.equal(graph.edges.length,1);
  assert.equal(graph.localOnly,true);
  assert.ok(calls.every(u=>u.startsWith("https://api.github.com/")||u==="https://api.openai.com/v1/responses"));
 }finally{globalThis.fetch=original;}
});
test("Cannot generate without a key or with an unexpected hostname",async()=>{
 const a=await worker.fetch(req("/api/diagram","POST",{repo:"sample/project"}),env,allow);
 assert.equal(a.status,401);
 const b=await worker.fetch(new Request("https://other.example/api/keys"),env,allow);
 assert.equal(b.status,403);
});


test("GitHub redirects are rejected without forwarding a token or calling OpenAI",async()=>{
  const key="sk-"+("d".repeat(26)),githubToken="github_pat_"+("e".repeat(26));
  const input=new Request(base+"/api/diagram",{method:"POST",headers:{
    Origin:base,"Sec-Fetch-Site":"same-origin","Content-Type":"application/json",
    Cookie:"__Host-gd_openai="+encodeURIComponent(key)+"; __Host-gd_github="+encodeURIComponent(githubToken)
  },body:JSON.stringify({repo:"sample/project"})});
  const prior=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(url,options={})=>{
    calls++;
    assert.equal(String(url),"https://api.github.com/repos/sample/project");
    assert.equal(options.redirect,"manual");
    assert.equal(options.headers.Authorization,"Bearer "+githubToken);
    return new Response(null,{status:302,headers:{Location:"https://untrusted.example/collect"}});
  };
  try{
    const response=await worker.fetch(input,env,allow);
    assert.equal(response.status,502);
    assert.match((await response.json()).error,/GitHub redirected unexpectedly/);
    assert.equal(calls,1);
  }finally{globalThis.fetch=prior;}
});
test("OpenAI redirects are rejected with manual redirect mode",async()=>{
  const key="sk-"+("f".repeat(26));
  const input=new Request(base+"/api/diagram",{method:"POST",headers:{
    Origin:base,"Sec-Fetch-Site":"same-origin","Content-Type":"application/json",
    Cookie:"__Host-gd_openai="+encodeURIComponent(key)
  },body:JSON.stringify({repo:"sample/project"})});
  const prior=globalThis.fetch;
  let aiCalls=0;
  globalThis.fetch=async(url,options={})=>{
    const u=String(url);
    assert.equal(options.redirect,"manual");
    if(u==="https://api.github.com/repos/sample/project")
      return Response.json({default_branch:"main",description:"Sample project"});
    if(u.startsWith("https://api.github.com/repos/sample/project/git/trees/"))
      return Response.json({tree:[{type:"blob",path:"src/index.ts",size:100}]});
    if(u.includes("/contents/"))
      return Response.json({encoding:"base64",content:Buffer.from("export const example = true;").toString("base64")});
    if(u==="https://api.openai.com/v1/responses"){
      aiCalls++;
      assert.equal(options.headers.Authorization,"Bearer "+key);
      return new Response(null,{status:307,headers:{Location:"https://untrusted.example/collect"}});
    }
    throw new Error("Unexpected outbound request "+u);
  };
  try{
    const response=await worker.fetch(input,env,allow);
    assert.equal(response.status,502);
    assert.match((await response.json()).error,/OpenAI redirected unexpectedly/);
    assert.equal(aiCalls,1);
  }finally{globalThis.fetch=prior;}
});
