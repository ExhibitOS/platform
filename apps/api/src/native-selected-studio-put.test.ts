// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-only sequencing cases. Mock owners/Auth/Studio are NOT actual native
// claim, PostgreSQL COMMIT, workspace-fence or Manager Session evidence.
import Fastify,{type FastifyRequest} from 'fastify';
import {PassThrough} from 'node:stream';
import {request as httpRequest} from 'node:http';
import type {Pool,PoolClient} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';
import {Auth,ApiError,type Session} from './auth.ts';
import {Studio,type StudioResponse} from './studio.ts';
import {createSelectedStudioPutSlot,registerSelectedStudioPutGate,armSelectedStudioPut,closeSelectedStudioPutSlot,drainSelectedStudioPutSlot,awaitSelectedStudioPut,runSelectedStudioPut,type SelectedStudioClaim} from './native-selected-studio-put.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const claim:SelectedStudioClaim={sessionId:id(1),tenantId:id(2),principalId:id(3),workspaceId:id(4),runtimeGeneration:id(5),jobId:id(6),attemptId:id(7),generation:id(8),stageId:id(9),reservationId:id(10),reservationGeneration:id(11),exhibitionId:id(12),requestId:id(13)};
const origin='http://127.0.0.1:13200',url=`/api/v1/tenants/${claim.tenantId}/studio/exhibitions/${claim.exhibitionId}`;
const initial={revision:1,etag:'"studio-r1-'+ 'a'.repeat(64)+'"',draft:{kind:'exhibition-draft',exhibitionId:claim.exhibitionId,id:id(14),candidate:{title:'Synthetic'}}} as StudioResponse;
const headers={host:'127.0.0.1:13200',origin,cookie:'exhibitos_local_session=synthetic','x-csrf-token':'synthetic','if-match':initial.etag};
const body=()=>({draft:structuredClone(initial.draft),requestId:claim.requestId});
class TestAuth extends Auth{
 session={id:claim.sessionId,tenantId:claim.tenantId,userId:claim.principalId,role:'admin'} as Session;
 afterWork?:()=>Promise<void>;
 override async request<T>(_token:string|undefined,_tenant:string|undefined,_csrf:string|undefined,_mutate:boolean,work:(c:PoolClient,s:Session)=>Promise<T>):Promise<T>{const result=await work({} as PoolClient,this.session);await this.afterWork?.();return result;}
}
const apps:ReturnType<typeof Fastify>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(a=>a.close()));vi.restoreAllMocks();});
function setup(selected=true){
 const app=Fastify();apps.push(app);const requests:FastifyRequest[]=[],parsing:string[]=[];
 app.setErrorHandler((e,_req,reply)=>reply.code(e instanceof ApiError?e.status:(e as {statusCode?:number}).statusCode??500).send({code:e.message}));
 app.addHook('onRequest',async req=>{requests.push(req);});app.addHook('preParsing',async(req,_reply,payload)=>{parsing.push(req.url);return payload;});
 let auth:TestAuth;
 let reads=0;const readRows=vi.fn(()=>[{id:auth.session.id,user_id:auth.session.userId,tenant_id:auth.session.tenantId,role:auth.session.role,csrf_token:'synthetic',expires_at:new Date('2099-01-01T00:00:00Z')}]);
 const query=vi.fn(async(sql:string)=>{if(sql.includes('FROM auth_sessions')){reads++;return {rows:readRows(),rowCount:1};}if(sql==='COMMIT')await auth.afterWork?.();return {rows:[],rowCount:0};});
 const release=vi.fn(),pool={connect:vi.fn(async()=>({query,release}))} as unknown as Pool;
 auth=new TestAuth(pool);const studio=new Studio(),slot=createSelectedStudioPutSlot();
 const get=vi.spyOn(studio,'get').mockImplementation(async()=>structuredClone(initial));
 const put=vi.spyOn(studio,'put').mockImplementation(async()=>({...structuredClone(initial),revision:2}));
 let live=true;const owner={assertCommittedImport:vi.fn(async(_claim:Readonly<SelectedStudioClaim>)=>{}),assertDatabase:vi.fn(async(_c:PoolClient)=>{}),assertLive:vi.fn(async()=>{if(!live)throw new ApiError(409,'OWNER_LOST');}),runScoped:vi.fn(async<T>(work:()=>Promise<T>)=>work())};
 if(selected)registerSelectedStudioPutGate(app,auth,{mode:'local',origin,bindHost:'127.0.0.1'},studio,slot);
 app.put('/api/v1/tenants/:tenantId/studio/exhibitions/:id',{bodyLimit:1048576},async(req,reply)=>{
  if(!selected)return {ordinary:true};return runSelectedStudioPut(slot,req,reply,async(c,s)=>{const result=await studio.put(c,s,(req.params as {id:string}).id,req.body as ReturnType<typeof body>,req.headers['if-match'] as string);reply.header('etag',result.etag);return result;});
 });
 app.post('/unrelated',()=>({written:true}));app.delete('/unrelated',()=>({written:true}));app.get('/read',()=>({read:true}));
 app.post('/api/v1/tenants/:tenantId/native-oex/imports',()=>({uploadPlugin:'test-double-only'}));
 return {app,slot,auth,studio,owner,get,put,requests,parsing,query,readRows,reads:()=>reads,release,lose:()=>{live=false;},arm:()=>armSelectedStudioPut(slot,owner,claim)};
}
it('leaves ordinary mode unchanged; selected mode denies unrelated writes and unarmed PUT before parsing',async()=>{
 const ordinary=setup(false);expect((await ordinary.app.inject({method:'PUT',url,payload:body()})).json()).toEqual({ordinary:true});
 const f=setup();for(const method of ['POST','DELETE'] as const)expect((await f.app.inject({method,url:'/unrelated',payload:method==='POST'?{}:undefined})).statusCode).toBe(403);
 expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(409);expect(f.parsing).toEqual([]);expect((await f.app.inject('/read')).statusCode).toBe(200);expect(f.put).not.toHaveBeenCalled();
});
it('arms only after committed-owner check and bounded tokenless DB GET COMMIT; snapshots returned draft',async()=>{
 const f=setup(),observed=await f.arm();expect(f.owner.assertCommittedImport).toHaveBeenCalledWith(claim);expect(f.get).toHaveBeenCalledOnce();observed.draft.candidate.title='caller mutation';
 expect(f.reads()).toBe(2);expect(f.query.mock.calls.map(c=>c[0])).toEqual(expect.arrayContaining(['BEGIN','SET TRANSACTION ISOLATION LEVEL READ COMMITTED',"SET LOCAL statement_timeout='10s'","SET LOCAL lock_timeout='5s'",'SELECT pg_advisory_xact_lock_shared(82003)','SELECT pg_advisory_xact_lock_shared(82002)','COMMIT']));expect(f.release).toHaveBeenCalledOnce();expect(f.query.mock.calls.map(c=>c[0]).join('\n')).not.toMatch(/token_hash|csrf_hash/);
 expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(200);expect(f.put).toHaveBeenCalledOnce();
 const observedCommit=await awaitSelectedStudioPut(f.slot);expect(observedCommit.revision).toBe(2);expect(Object.isFrozen(observedCommit)).toBe(true);expect(Object.isFrozen(observedCommit.draft.candidate)).toBe(true);
 expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(409);
});
it('refuses expired/revoked authority or changed role at the final post-lock check and never arms after uncertain read COMMIT',async()=>{
 const f=setup();f.readRows.mockImplementationOnce(()=>[{id:claim.sessionId,user_id:claim.principalId,tenant_id:claim.tenantId,role:'admin',csrf_token:'synthetic',expires_at:new Date('2099-01-01T00:00:00Z')}]).mockImplementationOnce(()=>[]);
 await expect(f.arm()).rejects.toThrow('FORBIDDEN');expect(f.query.mock.calls.map(c=>c[0])).toContain('ROLLBACK');expect(f.query.mock.calls.map(c=>c[0])).not.toContain('COMMIT');
 const g=setup();g.readRows.mockImplementationOnce(()=>[{id:claim.sessionId,user_id:claim.principalId,tenant_id:claim.tenantId,role:'admin',csrf_token:'synthetic',expires_at:new Date('2099-01-01T00:00:00Z')}]).mockImplementationOnce(()=>[{id:claim.sessionId,user_id:claim.principalId,tenant_id:claim.tenantId,role:'artist',csrf_token:'synthetic',expires_at:new Date('2099-01-01T00:00:00Z')}]);await expect(g.arm()).rejects.toThrow('FORBIDDEN');
 const h=setup();h.auth.afterWork=async()=>{throw Error('read COMMIT unknown');};await expect(h.arm()).rejects.toThrow('read COMMIT unknown');await expect(h.arm()).rejects.toThrow('NATIVE_STUDIO_CLOSED');expect(h.put).not.toHaveBeenCalled();
});
it('does not arm from a different authenticated Session or failed committed-owner check',async()=>{
 const f=setup();f.auth.session.id=id(99);await expect(f.arm()).rejects.toThrow('FORBIDDEN');expect(f.get).not.toHaveBeenCalled();f.auth.session.id=claim.sessionId;await expect(f.arm()).rejects.toThrow('NATIVE_STUDIO_CLOSED');
 const g=setup();g.owner.assertCommittedImport.mockRejectedValue(Error('COMMIT unknown'));await expect(g.arm()).rejects.toThrow('COMMIT unknown');expect(g.get).not.toHaveBeenCalled();
});
it('verifies the same GET and PUT transaction clients against the pinned database owner before and after work',async()=>{
 const f=setup();await f.arm();const readClient=f.get.mock.calls[0]![0];expect(f.owner.assertDatabase.mock.calls.map(call=>call[0])).toEqual([readClient,readClient]);
 expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(200);const putClient=f.put.mock.calls[0]![0];expect(f.owner.assertDatabase.mock.calls.slice(2).map(call=>call[0])).toEqual([putClient,putClient]);
 for(const phase of ['initial-get','final-get','initial-put','final-put'] as const){const g=setup();if(phase.endsWith('get')){g.owner.assertDatabase.mockImplementationOnce(async()=>{if(phase==='initial-get')throw Error('DATABASE_OWNER_MISMATCH');}).mockRejectedValueOnce(Error('DATABASE_OWNER_MISMATCH'));await expect(g.arm()).rejects.toThrow('DATABASE_OWNER_MISMATCH');expect(g.query.mock.calls.map(call=>call[0])).not.toContain('COMMIT');expect(g.get).toHaveBeenCalledTimes(phase==='initial-get'?0:1);}else{await g.arm();g.owner.assertDatabase.mockImplementationOnce(async()=>{if(phase==='initial-put')throw Error('DATABASE_OWNER_MISMATCH');}).mockRejectedValueOnce(Error('DATABASE_OWNER_MISMATCH'));expect((await g.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(500);expect(g.put).toHaveBeenCalledTimes(phase==='initial-put'?0:1);}
  await expect(awaitSelectedStudioPut(g.slot)).rejects.toThrow('NATIVE_STUDIO_CLOSED');
 }
});
it('checks actual PUT Session.id, exact draft and internal requestId, without a retry',async()=>{
 for(const mode of ['session','draft','request'] as const){const f=setup();await f.arm();const payload=body();if(mode==='session')f.auth.session.id=id(99);if(mode==='draft')payload.draft.candidate.title='changed';if(mode==='request')payload.requestId=id(99);
  expect((await f.app.inject({method:'PUT',url,headers,payload})).statusCode).toBe(mode==='session'?403:409);expect(f.put).not.toHaveBeenCalled();expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(409);
 }
});
it('checks exact target, old ETag and Host/Origin before parsing',async()=>{
 const f=setup();await f.arm();const before=f.parsing.length;
 for(const request of [{url:url.replace(claim.exhibitionId,id(99)),headers},{url,headers:{...headers,'if-match':'"studio-r2-'+ 'b'.repeat(64)+'"'}},{url,headers:{...headers,origin:'http://other.invalid'}}])expect((await f.app.inject({method:'PUT',...request,payload:body()})).statusCode).toBeGreaterThanOrEqual(400);
 expect(f.parsing).toHaveLength(before);expect(f.put).not.toHaveBeenCalled();
});
it('consumes admission before a streaming body and refuses a concurrent body before parsing',async()=>{
 const f=setup();await f.arm();const stream=new PassThrough(),first=Promise.resolve(f.app.inject({method:'PUT',url,headers:{...headers,'content-type':'application/json'},payload:stream}));
 try{await vi.waitFor(()=>expect(f.parsing).toHaveLength(1));expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(409);expect(f.parsing).toHaveLength(1);}finally{stream.end(JSON.stringify(body()));}
 expect((await first).statusCode).toBe(200);expect(f.put).toHaveBeenCalledOnce();
});
it('malformed body permanently consumes the slot; upload writes also stop after arming',async()=>{
 const f=setup();await f.arm();expect((await f.app.inject({method:'POST',url:`/api/v1/tenants/${claim.tenantId}/native-oex/imports`,payload:{}})).statusCode).toBe(403);
 expect((await f.app.inject({method:'PUT',url,headers:{...headers,'content-type':'application/json'},payload:'{'})).statusCode).toBe(400);expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(409);expect(f.put).not.toHaveBeenCalled();
 await expect(awaitSelectedStudioPut(f.slot)).rejects.toThrow('NATIVE_STUDIO_CLOSED');
});
it('waits through actual COMMIT after EOF and never admits a replacement',async()=>{
 const f=setup();await f.arm();let entered!:()=>void,resolve!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{resolve=r;});f.auth.afterWork=async()=>{entered();await gate;};
 let responded=false,observed=false;const observation=awaitSelectedStudioPut(f.slot).finally(()=>{observed=true;});void observation.catch(()=>{});const pending=Promise.resolve(f.app.inject({method:'PUT',url,headers,payload:body()})).then(r=>{responded=true;return r;});
 try{await ready;f.requests.at(-1)!.raw.emit('aborted');await new Promise(r=>setImmediate(r));expect(responded).toBe(false);expect(observed).toBe(false);expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(409);}finally{resolve();}
 expect((await pending).statusCode).toBe(409);expect(f.put).toHaveBeenCalledOnce();
 await expect(observation).rejects.toThrow('NATIVE_STUDIO_CLOSED');
});
it('waits for the real transaction if owner scope fails early, and closes on unknown COMMIT',async()=>{
 const f=setup();await f.arm();let entered!:()=>void,resolve!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{resolve=r;});f.auth.afterWork=async()=>{entered();await gate;};
 f.owner.runScoped.mockImplementationOnce(async work=>{void work().catch(()=>{});await ready;throw Error('OWNER_LOST');});
 let responded=false;const pending=Promise.resolve(f.app.inject({method:'PUT',url,headers,payload:body()})).then(r=>{responded=true;return r;});
 try{await ready;await new Promise(r=>setImmediate(r));expect(responded).toBe(false);}finally{resolve();}expect((await pending).statusCode).toBe(500);
 const g=setup();await g.arm();g.auth.afterWork=async()=>{throw Error('unknown COMMIT');};expect((await g.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(500);await expect(g.arm()).rejects.toThrow('NATIVE_STUDIO_CLOSED');expect(g.put).toHaveBeenCalledOnce();
 await expect(awaitSelectedStudioPut(g.slot)).rejects.toThrow('NATIVE_STUDIO_CLOSED');
});
it('does not resolve the private observer before actual PUT COMMIT or after postcommit owner loss',async()=>{
 const f=setup();await f.arm();let entered!:()=>void,resolve!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{resolve=r;});f.auth.afterWork=async()=>{entered();await gate;};
 let observed=false;const observation=awaitSelectedStudioPut(f.slot).then(r=>{observed=true;return r;});const pending=Promise.resolve(f.app.inject({method:'PUT',url,headers,payload:body()}));
 try{await ready;await new Promise(r=>setImmediate(r));expect(observed).toBe(false);}finally{resolve();}expect((await pending).statusCode).toBe(200);expect((await observation).revision).toBe(2);
 const g=setup();await g.arm();g.auth.afterWork=async()=>g.lose();expect((await g.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(409);await expect(awaitSelectedStudioPut(g.slot)).rejects.toThrow('NATIVE_STUDIO_CLOSED');
 const h=setup();closeSelectedStudioPutSlot(h.slot);await expect(awaitSelectedStudioPut(h.slot)).rejects.toThrow('NATIVE_STUDIO_CLOSED');
});
it('closing or a second arm attempt while GET is pending cannot install a replacement',async()=>{
 const f=setup();let resolve!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{resolve=r;}),ready=new Promise<void>(r=>{entered=r;});f.auth.afterWork=async()=>{entered();await gate;};const pending=f.arm();
 await ready;closeSelectedStudioPutSlot(f.slot);let drained=false;const draining=drainSelectedStudioPutSlot(f.slot).then(()=>{drained=true;});
 try{await new Promise(r=>setImmediate(r));expect(drained).toBe(false);}finally{resolve();}
 await expect(pending).rejects.toThrow('NATIVE_STUDIO_CLOSED');await draining;await expect(f.arm()).rejects.toThrow('NATIVE_STUDIO_CLOSED');expect(f.put).not.toHaveBeenCalled();
});
it('private close cancels only its admitted stalled JSON stream and drains before graceful server close',async()=>{
 const f=setup();await f.arm();const address=await f.app.listen({host:'127.0.0.1',port:0}),before=f.parsing.length;
 const client=httpRequest(new URL(url,address),{method:'PUT',headers:{...headers,'content-type':'application/json','content-length':String(Buffer.byteLength(JSON.stringify(body())))}});
 const clientClosed=new Promise<void>(resolve=>{client.once('error',()=>{});client.once('close',resolve);});client.write('{'); // Never finish the body.
 try{
  await vi.waitFor(()=>expect(f.parsing).toHaveLength(before+1));const admitted=f.requests.at(-1)!.raw;let terminal=false;admitted.once('close',()=>{terminal=true;});
  const observation=awaitSelectedStudioPut(f.slot);closeSelectedStudioPutSlot(f.slot);await drainSelectedStudioPutSlot(f.slot);
  await expect(observation).rejects.toThrow('NATIVE_STUDIO_CLOSED');expect(admitted.destroyed).toBe(true);expect(terminal).toBe(true);expect(f.put).not.toHaveBeenCalled();
  expect((await f.app.inject('/read')).json()).toEqual({read:true});await f.app.close();await clientClosed;
 }finally{client.destroy();await clientClosed;}
});
it('emits fixed selected PUT stages without request data on success and rejection',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{}),f=setup();await f.arm();
 expect((await f.app.inject({method:'PUT',url,headers,payload:body()})).statusCode).toBe(200);
 expect(log.mock.calls).toEqual([['NATIVE_OEX_SELECTED put-received'],['NATIVE_OEX_SELECTED put-admitted'],['NATIVE_OEX_SELECTED put-body-matched'],['NATIVE_OEX_SELECTED put-commit-returned'],['NATIVE_OEX_SELECTED put-scope-returned']]);
 log.mockClear();const g=setup();await g.arm();expect((await g.app.inject({method:'PUT',url,headers:{...headers,origin:'http://other.invalid'},payload:body()})).statusCode).toBe(403);
 expect(log.mock.calls).toEqual([['NATIVE_OEX_SELECTED put-received'],['NATIVE_OEX_SELECTED put-rejected']]);
});
