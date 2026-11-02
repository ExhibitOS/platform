// SPDX-License-Identifier: AGPL-3.0-or-later
import Fastify from 'fastify';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {ApiError,type Auth,type AuthConfig,type Session} from './auth.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import type {Oex} from './oex.ts';
import {registerNativeBoundedOexExport} from './native-bounded-oex-export.ts';
const workspaceId='10000000-0000-4000-8000-000000000001',tenantId='20000000-0000-4000-8000-000000000001',userId='30000000-0000-4000-8000-000000000001',sessionId='40000000-0000-4000-8000-000000000001';
const session={id:sessionId,tenantId,userId,role:'artist',expiresAt:'2099-01-01T00:00:00.000Z'} as Session;
async function setup(options:{failCommit?:boolean;failProducer?:boolean;otherSession?:boolean}={}){
 const root=await mkdtemp(join(await realpath(tmpdir()),'exhibitos-selected-export-')),blobs=join(root,'blobs');await mkdir(blobs,{mode:0o700});const bytes=Buffer.from('synthetic bounded output'),events:string[]=[];let calls=0;
 const auth={request:vi.fn(async(_token:unknown,_tenant:unknown,_csrf:unknown,_mutate:unknown,work:(c:unknown,s:Session)=>Promise<unknown>)=>{calls++;events.push(`begin${calls}`);const current=options.otherSession&&calls===2?{...session,id:'50000000-0000-4000-8000-000000000001'}:session;const value=await work({},current);if(options.failCommit&&calls===1)throw Error('COMMIT_FAILED');events.push(`commit${calls}`);return value;})} as unknown as Auth;
 const oex={exportBoundedFile:vi.fn(async(_c:unknown,_s:unknown,_id:unknown,_match:unknown,path:string)=>{await writeFile(path,bytes,{mode:0o600});if(options.failProducer)throw Error('PRODUCER_FAILED');return {bytes:bytes.length,omittedImported:[],checkRights:()=>{}};}),revalidateBoundedExport:vi.fn(async()=>()=>{})} as unknown as Oex;
 const context={workspaceId,tenantId,principalId:userId,assertDatabase:vi.fn(async()=>{})} as unknown as NativeOexWorkspaceContext;
 const app=Fastify();app.setErrorHandler((error,_req,reply)=>reply.code(error instanceof ApiError?error.status:500).send({code:error instanceof ApiError?error.code:'INTERNAL_ERROR'}));registerNativeBoundedOexExport(app,{auth,config:{mode:'local'} as AuthConfig,context,blobRoot:blobs,oex,guard:()=>{},token:()=> 'test'});
 const request=()=>app.inject({method:'POST',url:`/api/v1/tenants/${tenantId}/studio/exhibitions/${workspaceId}/native-oex/export`,headers:{'if-match':'"studio-r1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'},payload:{}});
 return {root,stage:join(root,`native-oex-export-${workspaceId}`),app,request,bytes,events,oex};
}
it('sends only after both authentication transactions and returns the owned stage after response drain',async()=>{
 const x=await setup();try{const r=await x.request();expect(r.statusCode).toBe(200);expect(r.rawPayload).toEqual(x.bytes);expect(x.events).toEqual(['begin1','commit1','begin2','commit2']);expect(r.headers['content-length']).toBe(String(x.bytes.length));expect(r.headers['x-exhibitos-oex-sha256']).toBe(createHash('sha256').update(x.bytes).digest('hex'));expect(r.headers['x-exhibitos-oex-profile']).toBe('bounded-file-v1');expect(r.headers['cache-control']).toBe('no-store');await vi.waitFor(async()=>{await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});});}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('closes and removes a known inode when the first authentication commit fails',async()=>{
 const x=await setup({failCommit:true});try{const r=await x.request();expect(r.statusCode).toBe(500);await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('retains an uncertain producer file without returning bytes',async()=>{
 const x=await setup({failProducer:true});try{const r=await x.request();expect(r.statusCode).toBe(409);expect(r.json().code).toBe('NATIVE_OEX_EXPORT_FILE_UNCERTAIN');expect(await readFile(join(x.stage,'archive.oex'))).toEqual(x.bytes);}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('refuses a changed session before sending and disposes the known staged inode',async()=>{
 const x=await setup({otherSession:true});try{const r=await x.request();expect(r.statusCode).toBe(403);expect(r.rawPayload).not.toEqual(x.bytes);await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('does not adopt or delete a previous uncertain stage',async()=>{
 const x=await setup();await mkdir(x.stage,{mode:0o700});await writeFile(join(x.stage,'archive.oex'),'old',{mode:0o600});try{const r=await x.request();expect(r.statusCode).toBe(409);expect(await readFile(join(x.stage,'archive.oex'),'utf8')).toBe('old');expect(x.oex.exportBoundedFile).not.toHaveBeenCalled();}finally{await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('aborts and drains an in-flight producer when a real local server closes',async()=>{
 const x=await setup();let entered!:()=>void;const started=new Promise<void>(r=>entered=r),aborted=vi.fn();
 vi.mocked(x.oex.exportBoundedFile).mockImplementation(async(_c,_s,_id,_match,path,signal)=>{await writeFile(path,x.bytes,{mode:0o600});entered();await new Promise<void>(resolve=>{if(signal.aborted){aborted();resolve();}else signal.addEventListener('abort',()=>{aborted();resolve();},{once:true});});return {bytes:x.bytes.length,omittedImported:[],checkRights:()=>{}};});
 try{
  const address=await x.app.listen({host:'127.0.0.1',port:0}),request=fetch(`${address}/api/v1/tenants/${tenantId}/studio/exhibitions/${workspaceId}/native-oex/export`,{method:'POST',headers:{'content-type':'application/json','if-match':'"studio-r1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'},body:'{}'}).then(async response=>{await response.arrayBuffer();return response.status;}).catch(()=>undefined);
  await Promise.race([started,request.then(status=>{throw Error('request ended before producer: '+String(status));}),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('producer did not start')),2000))]);await Promise.race([x.app.close(),new Promise<never>((_,reject)=>setTimeout(async()=>{const present=await stat(x.stage).then(()=>true,()=>false);reject(Error('server close did not drain; aborted='+aborted.mock.calls.length+' stage='+present+' events='+JSON.stringify(x.events)));},2000))]);await request;expect(aborted).toHaveBeenCalledOnce();await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});
 }finally{x.app.server.closeAllConnections();await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
it('rejects a second export while the selected workspace owns a stage',async()=>{
 const x=await setup();let entered!:()=>void,finish!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>finish=r);
 vi.mocked(x.oex.exportBoundedFile).mockImplementation(async(_c,_s,_id,_match,path)=>{await writeFile(path,x.bytes,{mode:0o600});entered();await gate;return {bytes:x.bytes.length,omittedImported:[],checkRights:()=>{}};});
 try{const first=Promise.resolve(x.request());await started;const second=await x.request();expect(second.statusCode).toBe(409);finish();const result=await first;expect(result.statusCode).toBe(200);expect(result.rawPayload).toEqual(x.bytes);await vi.waitFor(async()=>{await expect(stat(x.stage)).rejects.toMatchObject({code:'ENOENT'});});}
 finally{finish();await x.app.close();await rm(x.root,{recursive:true,force:true});}
});
