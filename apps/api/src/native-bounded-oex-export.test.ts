// SPDX-License-Identifier: AGPL-3.0-or-later
import Fastify from 'fastify';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {ApiError,type Auth,type AuthConfig,type Session} from './auth.ts';
import type {NativeLocalExportContext} from './native-oex-provenance.ts';
import type {Oex} from './oex.ts';
import {registerNativeBoundedOexExport} from './native-bounded-oex-export.ts';
const workspaceId='10000000-0000-4000-8000-000000000001',tenantId='20000000-0000-4000-8000-000000000001',userId='30000000-0000-4000-8000-000000000001',sessionId='40000000-0000-4000-8000-000000000001';
const session={id:sessionId,tenantId,userId,role:'artist',expiresAt:'2099-01-01T00:00:00.000Z'} as Session;
async function setup(options:{failCommit?:boolean;failProducer?:boolean;failAuth?:boolean;stale?:boolean;otherSession?:boolean;statusDifferent?:boolean;statusRoleChanged?:boolean}={}){
 const root=await mkdtemp(join(await realpath(tmpdir()),'exhibitos-selected-export-')),blobs=join(root,'blobs');await mkdir(blobs,{mode:0o700});const bytes=Buffer.from('synthetic bounded output'),events:string[]=[];let calls=0;
 const authorize=vi.fn(async(_token:unknown,_tenant:unknown,_csrf:unknown,_mutate:unknown,work:(c:unknown,s:Session)=>Promise<unknown>)=>{calls++;events.push(`begin${calls}`);if(options.failAuth&&calls===1)throw new ApiError(403,'CSRF_REJECTED');const current=(options.otherSession&&calls===2||options.statusDifferent&&calls>=3)?{...session,id:'50000000-0000-4000-8000-000000000001'}:options.statusRoleChanged&&calls>=3?{...session,role:'admin' as const}:session;const value=await work({},current);if(options.failCommit&&calls===1)throw Error('COMMIT_FAILED');events.push(`commit${calls}`);return value;});
 const auth={request:authorize,requestForExportPreparation:(token:unknown,tenant:unknown,csrf:unknown,work:(c:unknown,s:Session)=>Promise<unknown>)=>authorize(token,tenant,csrf,false,work)} as unknown as Auth;
 const oex={exportBoundedFile:vi.fn(async(_c:unknown,_s:unknown,_id:unknown,_match:unknown,path:string)=>{if(options.stale)throw new ApiError(412,'REMOTE_CONFLICT');await writeFile(path,bytes,{mode:0o600});if(options.failProducer)throw Error('PRODUCER_FAILED');return {bytes:bytes.length,omittedImported:[],checkRights:()=>{}};}),revalidateBoundedExport:vi.fn(async()=>()=>{})} as unknown as Oex;
 const context={workspaceId,tenantId,principalId:userId,assertDatabase:vi.fn(async()=>{})} as unknown as NativeLocalExportContext;
 const app=Fastify();app.setErrorHandler((error,_req,reply)=>reply.code(error instanceof ApiError?error.status:500).send({code:error instanceof ApiError?error.code:'INTERNAL_ERROR'}));registerNativeBoundedOexExport(app,{auth,config:{mode:'local'} as AuthConfig,context,blobRoot:blobs,oex,guard:()=>{},token:()=> 'test'});
 const request=(requestId=randomUUID())=>app.inject({method:'POST',url:`/api/v1/tenants/${tenantId}/studio/exhibitions/${workspaceId}/native-oex/export`,headers:{'if-match':'"studio-r1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'},payload:{requestId}});
 const status=(id:string,match='"studio-r1-'+ 'a'.repeat(64)+'"',progress=false)=>app.inject({method:'GET',url:`/api/v1/tenants/${tenantId}/studio/exhibitions/${workspaceId}/native-oex/exports/${id}${progress?'/progress':''}`,headers:{'if-match':match}});
 return {root,stage:join(root,`native-oex-export-${workspaceId}`),app,request,status,bytes,events,oex};
}
it('sends only after both authentication transactions and returns the owned stage after response drain',async()=>{
 const x=await setup(),requestId=randomUUID();try{const r=await x.request(requestId);expect(r.statusCode).toBe(200);expect(r.rawPayload).toEqual(x.bytes);expect(r.headers['x-exhibitos-oex-operation']).toBe(requestId);expect(x.events).toEqual(['begin1','commit1','begin2','commit2']);expect(r.headers['content-length']).toBe(String(x.bytes.length));expect(r.headers['x-exhibitos-oex-sha256']).toBe(createHash('sha256').update(x.bytes).digest('hex'));expect(r.headers['x-exhibitos-oex-profile']).toBe('bounded-file-v1');expect(r.headers['cache-control']).toBe('no-store');const operation=String(r.headers['x-exhibitos-oex-operation']);expect(operation).toMatch(/^[a-f0-9-]{36}$/);await vi.waitFor(async()=>{const status=await x.status(operation);expect(status.json()).toEqual({operationId:operation,state:'complete',etag:'"studio-r1-'+ 'a'.repeat(64)+'"',bytes:x.bytes.length,sha256:createHash('sha256').update(x.bytes).digest('hex')});});expect(x.oex.revalidateBoundedExport).toHaveBeenCalledTimes(2);expect((await x.status(operation,'"studio-r2-'+ 'b'.repeat(64)+'"')).statusCode).toBe(404);await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('closes and removes a known inode when the first authentication commit fails',async()=>{
 const x=await setup({failCommit:true}),requestId=randomUUID();try{const r=await x.request(requestId);expect(r.statusCode).toBe(500);await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});expect((await x.status(requestId)).json()).toEqual({operationId:requestId,state:'failed'});}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('confirms an authenticated stale revision had no successful output after its stage drains',async()=>{
 const x=await setup({stale:true}),requestId=randomUUID();try{const r=await x.request(requestId);expect(r.statusCode).toBe(412);await vi.waitFor(async()=>{expect((await x.status(requestId)).json()).toEqual({operationId:requestId,state:'failed'});});await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('marks a rejected authentication as not admitted for the exact request ID',async()=>{
 const x=await setup({failAuth:true}),requestId=randomUUID();try{const r=await x.request(requestId);expect(r.statusCode).toBe(403);expect(r.headers['x-exhibitos-oex-operation']).toBe(requestId);expect(r.headers['x-exhibitos-oex-admission']).toBe('attempt-not-admitted');expect(x.oex.exportBoundedFile).not.toHaveBeenCalled();expect((await x.status(requestId)).statusCode).toBe(404);}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('retains an uncertain producer file without returning bytes',async()=>{
 const x=await setup({failProducer:true}),requestId=randomUUID();try{const r=await x.request(requestId);expect(r.statusCode).toBe(409);expect(r.json().code).toBe('NATIVE_OEX_EXPORT_FILE_UNCERTAIN');expect(await readFile(join(x.stage,'archive.oex'))).toEqual(x.bytes);expect((await x.status(requestId)).json()).toEqual({operationId:requestId,state:'uncertain'});expect((await x.request(requestId)).statusCode).toBe(409);expect((await x.request()).statusCode).toBe(409);expect(x.oex.exportBoundedFile).toHaveBeenCalledOnce();}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('refuses a changed session before sending and disposes the known staged inode',async()=>{
 const x=await setup({otherSession:true});try{const r=await x.request();expect(r.statusCode).toBe(403);expect(r.rawPayload).not.toEqual(x.bytes);await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('reports a clean terminal as failed after rights change and permits a new explicit request',async()=>{
 const x=await setup();try{const response=await x.request(),operation=String(response.headers['x-exhibitos-oex-operation']);expect(response.statusCode).toBe(200);vi.mocked(x.oex.revalidateBoundedExport).mockRejectedValueOnce(new ApiError(403,'RIGHTS_DENIED'));
  await vi.waitFor(async()=>{const status=await x.status(operation);expect(status.json()).toEqual({operationId:operation,state:'failed'});});
  vi.mocked(x.oex.revalidateBoundedExport).mockResolvedValue(()=>{});const next=await x.request();expect(next.statusCode).toBe(200);
 }finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('keeps a clean receipt retryable when a resource revalidation is temporarily unavailable',async()=>{
 const x=await setup();try{const response=await x.request(),operation=String(response.headers['x-exhibitos-oex-operation']);expect(response.statusCode).toBe(200);await vi.waitFor(async()=>{await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});});
  vi.mocked(x.oex.revalidateBoundedExport).mockRejectedValueOnce(new ApiError(409,'FURNISHING_INTEGRITY'));await vi.waitFor(async()=>{const status=await x.status(operation);expect(status.statusCode).toBe(409);expect(status.json().code).toBe('FURNISHING_INTEGRITY');});
  const retry=await x.request();expect(retry.statusCode).toBe(409);expect(x.oex.exportBoundedFile).toHaveBeenCalledOnce();const status=await x.status(operation);expect(status.json().state).toBe('complete');
 }finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('allows a new authenticated session only after prior server cleanup without disclosing the old receipt',async()=>{
 const x=await setup({statusDifferent:true});try{const response=await x.request(),operation=String(response.headers['x-exhibitos-oex-operation']);expect(response.statusCode).toBe(200);await vi.waitFor(async()=>{await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});});expect((await x.status(operation)).statusCode).toBe(404);const next=await x.request();expect(next.statusCode).toBe(200);
 }finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('allows a new explicit operation after a clean terminal if the same session role changed',async()=>{
 const x=await setup({statusRoleChanged:true});try{const response=await x.request(),operation=String(response.headers['x-exhibitos-oex-operation']);expect(response.statusCode).toBe(200);await vi.waitFor(async()=>{await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});});expect((await x.status(operation)).statusCode).toBe(404);expect((await x.request()).statusCode).toBe(200);
 }finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('does not disclose a terminal receipt to another session',async()=>{
 const x=await setup({statusDifferent:true});try{const r=await x.request();expect(r.statusCode).toBe(200);const operation=String(r.headers['x-exhibitos-oex-operation']);const status=await x.status(operation);expect(status.statusCode).toBe(404);expect(status.rawPayload).not.toEqual(x.bytes);}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('does not adopt or delete a previous uncertain stage',async()=>{
 const x=await setup();await mkdir(x.stage,{mode:0o700});await writeFile(join(x.stage,'archive.oex'),'old',{mode:0o600});try{const r=await x.request();expect(r.statusCode).toBe(409);expect(await readFile(join(x.stage,'archive.oex'),'utf8')).toBe('old');expect(x.oex.exportBoundedFile).not.toHaveBeenCalled();}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('aborts and drains an in-flight producer when a real local server closes',async()=>{
 const x=await setup();let entered!:()=>void;const started=new Promise<void>(r=>entered=r),aborted=vi.fn();
 vi.mocked(x.oex.exportBoundedFile).mockImplementation(async(_c,_s,_id,_match,path,signal)=>{await writeFile(path,x.bytes,{mode:0o600});entered();await new Promise<void>(resolve=>{if(signal.aborted){aborted();resolve();}else signal.addEventListener('abort',()=>{aborted();resolve();},{once:true});});return {bytes:x.bytes.length,omittedImported:[],checkRights:()=>{}};});
 try{
  const address=await x.app.listen({host:'127.0.0.1',port:0}),request=fetch(`${address}/api/v1/tenants/${tenantId}/studio/exhibitions/${workspaceId}/native-oex/export`,{method:'POST',headers:{'content-type':'application/json','if-match':'"studio-r1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'},body:JSON.stringify({requestId:randomUUID()})}).then(async response=>{await response.arrayBuffer();return response.status;}).catch(()=>undefined);
  await Promise.race([started,request.then(status=>{throw Error('request ended before producer: '+String(status));}),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('producer did not start')),2000))]);await Promise.race([x.app.close(),new Promise<never>((_,reject)=>setTimeout(async()=>{const present=await stat(x.stage).then(()=>true,()=>false);reject(Error('server close did not drain; aborted='+aborted.mock.calls.length+' stage='+present+' events='+JSON.stringify(x.events)));},2000))]);await request;expect(aborted).toHaveBeenCalledOnce();await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});
 }finally{x.app.server.closeAllConnections();await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('rejects a second export while the selected workspace owns a stage',async()=>{
 const x=await setup(),requestId=randomUUID();let entered!:()=>void,finish!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>finish=r);
 vi.mocked(x.oex.exportBoundedFile).mockImplementation(async(_c,_s,_id,_match,path)=>{await writeFile(path,x.bytes,{mode:0o600});entered();await gate;return {bytes:x.bytes.length,omittedImported:[],checkRights:()=>{}};});
 try{const first=Promise.resolve(x.request(requestId));await started;const second=await x.request(requestId);expect(second.statusCode).toBe(409);expect(x.oex.exportBoundedFile).toHaveBeenCalledOnce();finish();const result=await first;expect(result.statusCode).toBe(200);expect(result.rawPayload).toEqual(x.bytes);await vi.waitFor(async()=>{await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});});}
 finally{finish();await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('publishes a same-session terminal receipt after a real local response has drained',async()=>{
 const x=await setup();try{
  const address=await x.app.listen({host:'127.0.0.1',port:0}),match='"studio-r1-'+ 'a'.repeat(64)+'"',base=`${address}/api/v1/tenants/${tenantId}/studio/exhibitions/${workspaceId}/native-oex`;
  const response=await fetch(`${base}/export`,{method:'POST',headers:{'content-type':'application/json','if-match':match},body:JSON.stringify({requestId:randomUUID()})});expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(x.bytes);
  const operation=response.headers.get('x-exhibitos-oex-operation');expect(operation).toMatch(/^[a-f0-9-]{36}$/);
  await vi.waitFor(async()=>{const status=await fetch(`${base}/exports/${operation}`,{headers:{'if-match':match}});expect(await status.json()).toEqual({operationId:operation,state:'complete',etag:match,bytes:x.bytes.length,sha256:createHash('sha256').update(x.bytes).digest('hex')});});
  await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});
 }finally{x.app.server.closeAllConnections();await x.app.close();await rm(x.root,{recursive:true,force:true});}
});

it('reports scoped in-flight progress without observing the terminal receipt',async()=>{
 const x=await setup(),operation=randomUUID();
 let entered!:()=>void,finish!:()=>void;
 const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>finish=resolve);
 vi.mocked(x.oex.exportBoundedFile).mockImplementationOnce(async(_c,_s,_id,_match,path,_signal,progress)=>{
  progress?.({phase:'packing',completedItems:1,totalItems:3});entered();await gate;
  await writeFile(path,x.bytes,{mode:0o600});progress?.({phase:'verifying'});
  return {bytes:x.bytes.length,omittedImported:[],checkRights:()=>{}};
 });
 try{
  const pending=Promise.resolve(x.request(operation));await started;
  expect((await x.request()).statusCode).toBe(409);
  const status=await x.status(operation,undefined,true);
  expect(status.statusCode).toBe(200);expect(status.json()).toEqual({operationId:operation,state:'pending',progress:{phase:'packing',completedItems:1,totalItems:3}});
  expect(status.headers['cache-control']).toBe('no-store');
  expect((await x.status(operation,'"studio-r2-'+ 'b'.repeat(64)+'"',true)).statusCode).toBe(404);
  expect((await x.status(randomUUID(),undefined,true)).statusCode).toBe(404);
  finish();expect((await pending).statusCode).toBe(200);
  await vi.waitFor(async()=>{await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});});
  expect((await x.status(operation,undefined,true)).statusCode).toBe(404);
  expect((await x.request()).statusCode).toBe(409);
  expect((await x.status(operation)).json().state).toBe('complete');
  expect((await x.request()).statusCode).toBe(200);
 }finally{finish();await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
