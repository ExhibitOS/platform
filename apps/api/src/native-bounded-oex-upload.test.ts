// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapter sequencing only. Mock owner/auth/core are NOT actual admission proof.
import Fastify,{type FastifyRequest} from 'fastify';
import {createHash} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {request as httpRequest} from 'node:http';
import type {Pool,PoolClient} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';
import {FileBlobStore} from '@exhibitos/storage';
import {Auth,ApiError,type Session} from './auth.ts';
import {bindSelectedNativeUpload,registerSelectedNativeOexUpload,createSelectedNativeUploadSlot,installSelectedNativeUpload,closeSelectedNativeUploadSlot,drainSelectedNativeUploadSlot,registerSelectedNativeOexUploadSlot,type NativeBoundedUploadCapability,type SelectedNativeUpload} from './native-bounded-oex-upload.ts';
const core=vi.hoisted(()=>({create:vi.fn(),put:vi.fn(),queue:vi.fn()}));
vi.mock('./oex-bounded-chunks.ts',()=>({createBoundedOexJob:core.create,putBoundedOexChunk:core.put,queueBoundedOexJob:core.queue}));
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,bytes=Buffer.from('abc'),sha256=createHash('sha256').update(bytes).digest('hex');
const selection={sessionId:id(7),tenantId:id(1),principalId:id(2),workspaceId:id(3),runtimeGeneration:id(4),requestId:id(5),bytes:bytes.length,sha256},job=id(6),origin='http://127.0.0.1:13200',path=`/api/v1/tenants/${selection.tenantId}/native-oex/imports`;
const input={requestId:selection.requestId,bytes:selection.bytes,sha256},headers={host:'127.0.0.1:13200',origin,cookie:'exhibitos_local_session=synthetic','x-csrf-token':'synthetic'};
class TestAuth extends Auth{
 session={id:selection.sessionId,tenantId:selection.tenantId,userId:selection.principalId,role:'admin'} as Session;
 afterWork?:()=>Promise<void>;
 override async request<T>(_token:string|undefined,_tenant:string|undefined,_csrf:string|undefined,_mutate:boolean,work:(c:PoolClient,s:Session)=>Promise<T>):Promise<T>{const result=await work({} as PoolClient,this.session);await this.afterWork?.();return result;}
}
const apps:ReturnType<typeof Fastify>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));vi.resetAllMocks();});
function setup(enabled=true){
 const app=Fastify();apps.push(app);app.setErrorHandler((error,_req,reply)=>reply.code(error instanceof ApiError?error.status:(error as {statusCode?:number}).statusCode??500).send({code:error.message}));
 const requests:FastifyRequest[]=[],parsing:string[]=[];app.addHook('onRequest',async req=>{requests.push(req);});app.addHook('preParsing',async(req,_reply,payload)=>{parsing.push(req.url);return payload;});
 const auth=new TestAuth({} as Pool),blobs=new FileBlobStore('/synthetic-unused');let live=true;
 const assertLive=vi.fn(async()=>{if(!live)throw new ApiError(409,'OWNER_LOST');}),assertDatabase=vi.fn(async(_c:PoolClient)=>{}),runScoped=vi.fn(async<T>(work:()=>Promise<T>)=>work()),cap=enabled?bindSelectedNativeUpload({assertLive,assertDatabase,runScoped},selection):undefined;
 core.create.mockResolvedValue({id:job,state:'uploading'});core.put.mockResolvedValue({index:0,received:bytes.length});core.queue.mockResolvedValue({id:job,state:'queued'});
 registerSelectedNativeOexUpload(app,auth,{mode:'local',origin,bindHost:'127.0.0.1'},blobs,cap);app.get('/ordinary',()=>({ok:true}));
 return {app,auth,blobs,cap,lose:()=>{live=false;},assertLive,assertDatabase,runScoped,parsing,requests};
}
function setupSlot(){
 const f=setup(false),slot=createSelectedNativeUploadSlot(),owner={assertLive:f.assertLive,assertDatabase:f.assertDatabase,runScoped:f.runScoped};
 registerSelectedNativeOexUploadSlot(f.app,f.auth,{mode:'local',origin,bindHost:'127.0.0.1'},f.blobs,slot);return {...f,slot,owner};
}
it('registers nothing without a capability and refuses a serialized or forged capability',async()=>{
 const f=setup(false);expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(404);expect((await f.app.inject('/ordinary')).json()).toEqual({ok:true});
 const app=Fastify();apps.push(app);expect(()=>registerSelectedNativeOexUpload(app,f.auth,{mode:'local',origin,bindHost:'127.0.0.1'},new FileBlobStore('/synthetic-unused'),{} as NativeBoundedUploadCapability)).toThrow('NATIVE_UPLOAD_CAPABILITY');expect(core.create).not.toHaveBeenCalled();
});
it('accepts only the selected principal, tenant and immutable test request',async()=>{
 const f=setup();f.auth.session.userId=id(9);expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(403);expect(core.create).not.toHaveBeenCalled();
 const g=setup();expect((await g.app.inject({method:'POST',url:path,headers,payload:{...input,sha256:'0'.repeat(64)}})).statusCode).toBe(409);expect(core.create).not.toHaveBeenCalled();
});
it('checks the pinned database owner on the exact Auth client before and after every upload operation',async()=>{
 const f=setup();await f.app.inject({method:'POST',url:path,headers,payload:input});const c=core.create.mock.calls.at(-1)![0];expect(f.assertDatabase.mock.calls.map(call=>call[0])).toEqual([c,c]);
 for(const kind of ['create','chunk','queue'] as const)for(const phase of ['before','after'] as const){const g=setup();if(kind!=='create')await g.app.inject({method:'POST',url:path,headers,payload:input});g.assertDatabase.mockClear();core.create.mockClear();core.put.mockClear();core.queue.mockClear();
  if(phase==='after')g.assertDatabase.mockResolvedValueOnce(undefined);g.assertDatabase.mockRejectedValueOnce(Error('DATABASE_OWNER_MISMATCH'));
  const request=kind==='create'?{method:'POST' as const,url:path,headers,payload:input}:kind==='queue'?{method:'POST' as const,url:path+`/${job}/queue`,headers,payload:{}}:{method:'PUT' as const,url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes};
  expect((await g.app.inject(request)).statusCode).toBe(500);const work=kind==='create'?core.create:kind==='chunk'?core.put:core.queue;expect(work).toHaveBeenCalledTimes(phase==='before'?0:1);
  if(phase==='after'){const actual=work.mock.calls[0]![0];expect(g.assertDatabase.mock.calls.map(call=>call[0])).toEqual([actual,actual]);}
  expect((await g.app.inject(request)).statusCode).toBe(409);expect(work).toHaveBeenCalledTimes(phase==='before'?0:1);
 }
});
it('rejects a second authenticated session of the same principal on every operation',async()=>{
 const f=setup();f.auth.session.id=id(8);expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(403);expect(core.create).not.toHaveBeenCalled();
 const g=setup();expect((await g.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(201);g.auth.session.id=id(8);
 expect((await g.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes})).statusCode).toBe(403);expect(core.put).not.toHaveBeenCalled();
 const h=setup();expect((await h.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(201);h.auth.session.id=id(8);
 expect((await h.app.inject({method:'POST',url:path+`/${job}/queue`,headers,payload:{}})).statusCode).toBe(403);expect(core.queue).not.toHaveBeenCalled();
});
it('keeps single-flight until COMMIT resolves and never adopts a precommit job',async()=>{
 const f=setup();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});f.auth.afterWork=async()=>{entered();await gate;};
 const first=f.app.inject({method:'POST',url:path,headers,payload:input});await ready;
 const concurrent=await f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes});expect(concurrent.statusCode).toBe(409);expect(core.put).not.toHaveBeenCalled();release();expect((await first).statusCode).toBe(201);
});
it('permanently closes after unknown COMMIT and does not create a replacement',async()=>{
 const f=setup();f.auth.afterWork=async()=>{throw Error('unknown COMMIT');};expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(500);
 f.auth.afterWork=undefined;expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(core.create).toHaveBeenCalledOnce();
});
it('retains uncertainty when the owner is lost after COMMIT',async()=>{
 const f=setup();f.auth.afterWork=async()=>f.lose();expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(core.create).toHaveBeenCalledOnce();
 expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(core.create).toHaveBeenCalledOnce();
});
it('checks chunk digest before writes and refuses another job',async()=>{
 const f=setup();await f.app.inject({method:'POST',url:path,headers,payload:input});const result=await f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':'0'.repeat(64)},payload:bytes});expect(result.statusCode).toBe(422);expect(core.put).not.toHaveBeenCalled();
 const g=setup();await g.app.inject({method:'POST',url:path,headers,payload:input});expect((await g.app.inject({method:'PUT',url:path+`/${id(9)}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes})).statusCode).toBe(403);expect(core.put).not.toHaveBeenCalled();
});
it('preserves Host/Origin rejection and enforces the actual 16MiB request limit',async()=>{
 const f=setup();expect((await f.app.inject({method:'POST',url:path,headers:{...headers,origin:'http://other.invalid'},payload:input})).statusCode).toBe(403);expect(core.create).not.toHaveBeenCalled();expect(f.runScoped).not.toHaveBeenCalled();
 expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(201);
 const payload=Buffer.alloc(16*1024*1024+1);expect((await f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload})).statusCode).toBe(413);expect(core.put).not.toHaveBeenCalled();
});
it('queues only through complete archive verification and rejects postqueue replay',async()=>{
 const f=setup();expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(201);
 expect((await f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes})).statusCode).toBe(200);
 expect((await f.app.inject({method:'POST',url:path+`/${job}/queue`,headers,payload:{}})).statusCode).toBe(200);expect(core.queue).toHaveBeenCalledOnce();
 expect((await f.app.inject({method:'POST',url:path+`/${job}/queue`,headers,payload:{}})).statusCode).toBe(409);expect(core.queue).toHaveBeenCalledOnce();
});
it('rejects a concurrent body before parsing while the admitted body is still arriving',async()=>{
 const f=setup();await f.app.inject({method:'POST',url:path,headers,payload:input});const before=f.parsing.length,stream=new PassThrough();
 const first=Promise.resolve(f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','content-length':String(bytes.length),'x-exhibitos-chunk-sha256':sha256},payload:stream}));
 try{
  await vi.waitFor(()=>expect(f.parsing).toHaveLength(before+1));
  const second=await f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes});
  expect(second.statusCode).toBe(409);expect(f.parsing).toHaveLength(before+1);expect(core.put).not.toHaveBeenCalled();
 }finally{stream.end(bytes);await first;}
 expect(core.put).toHaveBeenCalledOnce();
});
it('closes parser-failed admission without starting work or admitting a replacement body',async()=>{
 const f=setup(),before=f.parsing.length;
 const broken=await f.app.inject({method:'POST',url:path,headers:{...headers,'content-type':'application/json'},payload:'{'});
 expect(broken.statusCode).toBe(400);expect(core.create).not.toHaveBeenCalled();expect(f.parsing).toHaveLength(before+1);
 expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(f.parsing).toHaveLength(before+1);expect(core.create).not.toHaveBeenCalled();
});
it('waits for actual transaction work if the owner scope rejects while COMMIT is still pending',async()=>{
 const f=setup();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});
 f.auth.afterWork=async()=>{entered();await gate;};
 f.runScoped.mockImplementationOnce(async work=>{void work().catch(()=>{});await ready;throw new ApiError(409,'OWNER_LOST');});
 let responded=false;const request=Promise.resolve(f.app.inject({method:'POST',url:path,headers,payload:input})).then(value=>{responded=true;return value;});
 try{await ready;await vi.waitFor(()=>expect(f.runScoped).toHaveBeenCalledOnce());await new Promise(resolve=>setImmediate(resolve));expect(responded).toBe(false);expect(core.create).toHaveBeenCalledOnce();}
 finally{release();}
 expect((await request).statusCode).toBe(409);expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(core.create).toHaveBeenCalledOnce();
});
it('retains an aborted request until its already-started COMMIT work settles',async()=>{
 const f=setup();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});f.auth.afterWork=async()=>{entered();await gate;};
 let responded=false;const request=Promise.resolve(f.app.inject({method:'POST',url:path,headers,payload:input})).then(value=>{responded=true;return value;});
 try{await ready;f.requests.at(-1)!.raw.emit('aborted');await new Promise(resolve=>setImmediate(resolve));expect(responded).toBe(false);expect(core.create).toHaveBeenCalledOnce();}
 finally{release();}
 expect((await request).statusCode).toBe(409);expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(core.create).toHaveBeenCalledOnce();
});
it('pre-registers an unavailable slot and privately installs it once after the server is listening',async()=>{
 const f=setupSlot();await f.app.listen({host:'127.0.0.1',port:0});
 expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(f.parsing).toHaveLength(0);expect(core.create).not.toHaveBeenCalled();
 expect((await f.app.inject({method:'POST',url:path+'/install',headers,payload:selection})).statusCode).toBe(404);expect(core.create).not.toHaveBeenCalled();
 await installSelectedNativeUpload(f.slot,f.owner,selection);
 expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(201);expect(core.create).toHaveBeenCalledOnce();
 await expect(installSelectedNativeUpload(f.slot,f.owner,selection)).rejects.toThrow('NATIVE_UPLOAD_SLOT_CLOSED');
 expect((await f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes})).statusCode).toBe(409);expect(core.put).not.toHaveBeenCalled();
});
it('permanently closes an invalid or owner-lost installation without granting a second attempt',async()=>{
 const f=setupSlot();await expect(installSelectedNativeUpload(f.slot,f.owner,{...selection,sessionId:'invalid'} as SelectedNativeUpload)).rejects.toThrow();
 await expect(installSelectedNativeUpload(f.slot,f.owner,selection)).rejects.toThrow('NATIVE_UPLOAD_SLOT_CLOSED');expect(core.create).not.toHaveBeenCalled();
 const g=setupSlot();g.lose();await expect(installSelectedNativeUpload(g.slot,g.owner,selection)).rejects.toThrow('OWNER_LOST');
 expect((await g.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(core.create).not.toHaveBeenCalled();
});
it('cannot finish an installation after its private owner closes the slot',async()=>{
 const f=setupSlot();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});f.assertLive.mockImplementationOnce(async()=>{entered();await gate;});
 const installing=installSelectedNativeUpload(f.slot,f.owner,selection);await ready;closeSelectedNativeUploadSlot(f.slot);release();
 await expect(installing).rejects.toThrow('NATIVE_UPLOAD_SLOT_CLOSED');expect((await f.app.inject({method:'POST',url:path,headers,payload:input})).statusCode).toBe(409);expect(core.create).not.toHaveBeenCalled();
});
it('retains active COMMIT work when the privately installed slot is closed',async()=>{
 const f=setupSlot();await installSelectedNativeUpload(f.slot,f.owner,selection);
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});f.auth.afterWork=async()=>{entered();await gate;};
 let responded=false;const request=Promise.resolve(f.app.inject({method:'POST',url:path,headers,payload:input})).then(value=>{responded=true;return value;});
 try{await ready;closeSelectedNativeUploadSlot(f.slot);await new Promise(resolve=>setImmediate(resolve));expect(responded).toBe(false);}
 finally{release();}
 expect((await request).statusCode).toBe(409);expect(core.create).toHaveBeenCalledOnce();await expect(installSelectedNativeUpload(f.slot,f.owner,selection)).rejects.toThrow('NATIVE_UPLOAD_SLOT_CLOSED');
});
it('private drain waits for an admitted PUT COMMIT after closing new admission immediately',async()=>{
 const f=setupSlot();await installSelectedNativeUpload(f.slot,f.owner,selection);await f.app.inject({method:'POST',url:path,headers,payload:input});
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});f.auth.afterWork=async()=>{entered();await gate;};
 const put=()=>f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes});
 const request=Promise.resolve(put());await ready;let drained=false;const draining=drainSelectedNativeUploadSlot(f.slot).then(()=>{drained=true;});
 try{await new Promise(r=>setImmediate(r));expect(drained).toBe(false);const parsed=f.parsing.length;expect((await put()).statusCode).toBe(409);expect(f.parsing).toHaveLength(parsed);expect(core.put).toHaveBeenCalledOnce();}finally{release();}
 expect((await request).statusCode).toBe(409);await draining;expect(drained).toBe(true);await drainSelectedNativeUploadSlot(f.slot);
});
it('private drain waits for actual blob work even if the owner scope rejects before that work settles',async()=>{
 const f=setupSlot();await installSelectedNativeUpload(f.slot,f.owner,selection);await f.app.inject({method:'POST',url:path,headers,payload:input});
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});
 core.put.mockImplementationOnce(async()=>{entered();await gate;return {index:0,received:bytes.length};});
 f.runScoped.mockImplementationOnce(async work=>{void work().catch(()=>{});await ready;throw new ApiError(409,'OWNER_LOST');});
 const request=Promise.resolve(f.app.inject({method:'PUT',url:path+`/${job}/chunks/0`,headers:{...headers,'content-type':'application/octet-stream','x-exhibitos-chunk-sha256':sha256},payload:bytes}));
 await ready;closeSelectedNativeUploadSlot(f.slot);let drained=false;const draining=drainSelectedNativeUploadSlot(f.slot).then(()=>{drained=true;});
 try{await new Promise(r=>setImmediate(r));expect(drained).toBe(false);expect(core.put).toHaveBeenCalledOnce();}finally{release();}
 expect((await request).statusCode).toBe(409);await draining;expect(drained).toBe(true);
});
it('private close cancels only the admitted stalled incoming stream and drain waits for its terminal event',async()=>{
 const f=setupSlot();await installSelectedNativeUpload(f.slot,f.owner,selection);await f.app.inject({method:'POST',url:path,headers,payload:input});
 const address=await f.app.listen({host:'127.0.0.1',port:0}),before=f.parsing.length;
 const client=httpRequest(new URL(path+`/${job}/chunks/0`,address),{method:'PUT',headers:{...headers,'content-type':'application/octet-stream','content-length':String(bytes.length),'x-exhibitos-chunk-sha256':sha256}});
 const clientClosed=new Promise<void>(resolve=>{client.once('error',()=>{});client.once('close',resolve);});client.write(bytes.subarray(0,1)); // Deliberately never end the body.
 try{
  await vi.waitFor(()=>expect(f.parsing).toHaveLength(before+1));const admitted=f.requests.at(-1)!.raw;
  let terminal=false;admitted.once('close',()=>{terminal=true;});
  closeSelectedNativeUploadSlot(f.slot);await drainSelectedNativeUploadSlot(f.slot);
  expect(admitted.destroyed).toBe(true);expect(terminal).toBe(true);expect(core.put).not.toHaveBeenCalled();
  expect((await f.app.inject('/ordinary')).json()).toEqual({ok:true});await clientClosed;
 }finally{client.destroy();await clientClosed;}
});
