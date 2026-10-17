// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, expect } from "vitest";
import type { Pool } from "pg";
import { buildApp } from "./app.ts";
import { config } from "./auth.ts";
const origin="https://exhibitos-example.onrender.com", clientOrigin="https://exhibitos-example.pages.dev";
const pool={query:async()=>{throw Error("private credential must not escape");}} as unknown as Pool;
test("hosted credentials permit only one exact HTTPS Pages origin; local defaults unchanged",()=>{
 expect(config({mode:"network",origin,clientOrigin,bindHost:"127.0.0.1"}).clientOrigin).toBe(clientOrigin);
 for(const bad of ["http://example.pages.dev","https://example.pages.dev/path","https://user:secret@example.pages.dev"])expect(()=>config({mode:"network",origin,clientOrigin:bad,bindHost:"127.0.0.1"})).toThrow();
 expect(()=>config({mode:"local",origin:"http://127.0.0.1:13200",clientOrigin,bindHost:"127.0.0.1"})).toThrow();
});
test("explicit Pages preflight is bounded; unknown origin has no credential CORS",async()=>{
 const app=buildApp({pool,auth:{mode:"network",origin,clientOrigin,bindHost:"127.0.0.1"}});
 try {
  const headers={host:new URL(origin).host,origin:clientOrigin,"access-control-request-method":"POST","access-control-request-headers":"content-type,x-csrf-token"};
  const ok=await app.inject({method:"OPTIONS",url:"/api/v1/auth/login",headers});expect(ok.statusCode).toBe(204);expect(ok.headers["access-control-allow-origin"]).toBe(clientOrigin);expect(ok.headers["access-control-allow-credentials"]).toBe("true");
  const bad=await app.inject({method:"OPTIONS",url:"/api/v1/auth/login",headers:{...headers,origin:"https://other.pages.dev"}});expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  const extra=await app.inject({method:"OPTIONS",url:"/api/v1/auth/login",headers:{...headers,"access-control-request-headers":"authorization"}});expect(extra.statusCode).toBe(403);
 }finally{await app.close();}
});
test("Origin absent or foreign still cannot mutate auth even when hosted CORS exists",async()=>{
 for(const auth of [{mode:"network" as const,origin,clientOrigin,bindHost:"127.0.0.1"},{mode:"local" as const,origin:"http://127.0.0.1:13200",bindHost:"127.0.0.1"}]){
  const app=buildApp({pool,auth});try{
   for(const badOrigin of [undefined,"https://attacker.invalid"]){const response=await app.inject({method:"POST",url:"/api/v1/auth/login",headers:{host:new URL(auth.origin).host,...(badOrigin?{origin:badOrigin}:{})},payload:{subject:"synthetic",password:"synthetic-password",tenantId:"11111111-1111-4111-8111-111111111111"}});expect(response.statusCode).toBe(403);expect(response.body).not.toContain("private credential");}
  }finally{await app.close();}
 }
});
test("hosted public projection preserves selected identity and cannot grant private opening-host authority",async()=>{
 const pub="11111111-1111-4111-8111-111111111111",tenant="22222222-2222-4222-8222-222222222222",revision="a".repeat(64);
 const projection={publication:{id:pub,status:"published",revisionSha256:revision},exhibition:{id:"preserved-exhibition-id"}};
 let reads=0;
 const app=buildApp({pool,auth:{mode:"network",origin,clientOrigin,bindHost:"127.0.0.1"},publicationSource:{anonymous:async id=>{expect(id).toBe(pub);reads++;return projection;},asset:async()=>{throw Error("not selected");}}});
 try{
  const response=await app.inject({method:"GET",url:`/api/v1/publications/${pub}`,headers:{host:new URL(origin).host,origin:clientOrigin}});expect(response.statusCode).toBe(200);expect(response.json()).toEqual(projection);expect(reads).toBe(1);
  const grant=await app.inject({method:"POST",url:`/api/v1/tenants/${tenant}/studio/publications/${pub}/opening-host`,headers:{host:new URL(origin).host,origin:clientOrigin},payload:{revisionSha256:revision}});expect(grant.statusCode).toBe(401);expect(reads).toBe(1);
 }finally{await app.close();}
});
