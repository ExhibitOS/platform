// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath,rmdir,statfs,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {Auth,ApiError,uuid,type AuthConfig,type Session} from './auth.ts';
import type {NativeLocalExportContext} from './native-oex-provenance.ts';
import {requiredMatch} from './studio.ts';
import type {ImportedPreviewOmission,NativeOexExportProgress,Oex} from './oex.ts';

const MAX=512*1024*1024,RESERVE=1024*1024*1024;
type Owned={stage:string;path:string;stageDev:bigint;stageIno:bigint;fileDev:bigint;fileIno:bigint;bytes:number;sha256:string;handle:Awaited<ReturnType<typeof open>>;mtimeNs:bigint;ctimeNs:bigint;omitted:ImportedPreviewOmission[];sessionId:string;role:string};
type Receipt={operationId:string;tenantId:string;userId:string;sessionId:string;role:string;exhibitionId:string;etag:string;bytes:number;sha256:string;omitted:ImportedPreviewOmission[];state:'pending'|'complete'|'failed'|'uncertain';observed:boolean;progress?:NativeOexExportProgress};
/** Local native owner only. The ordinary origin, cookie and CSRF checks are
 * supplied by the existing Auth instance; neither paths nor owner identity are
 * accepted from the request. An uncertain stage is never adopted. */
export function registerNativeBoundedOexExport(app:FastifyInstance,input:{auth:Auth;config:AuthConfig;context:NativeLocalExportContext;blobRoot:string;oex:Oex;guard:(req:FastifyRequest,mutate:boolean)=>void;token:(req:FastifyRequest)=>string|undefined}){
 const {auth,context,blobRoot,oex,guard,token}=input;if(input.config.mode!=='local')throw Error('NATIVE_OEX_EXPORT_CONFIGURATION');
 const active=new Set<Promise<void>>(),controllers=new Set<AbortController>(),activeIds=new Set<string>();let closing=false,latest:Receipt|undefined;
 app.addHook('preClose',async()=>{closing=true;for(const controller of controllers)controller.abort();});
 app.addHook('onClose',async()=>{await Promise.allSettled([...active]);});
 app.post('/api/v1/tenants/:tenantId/studio/exhibitions/:id/native-oex/export',{schema:{body:{type:'object',additionalProperties:false,required:['requestId'],properties:{requestId:{type:'string',format:'uuid'}}}}},async(req,reply)=>{
  guard(req,true);reply.header('cache-control','no-store');const p=req.params as {tenantId:string;id:string},requestId=(req.body as {requestId:string}).requestId;uuid(p.tenantId);uuid(p.id);uuid(requestId);if(requestId!==requestId.toLowerCase())throw new ApiError(400,'INVALID_INPUT');const match=requiredMatch(req.headers['if-match']);
  if(closing)throw new ApiError(409,'NATIVE_OEX_EXPORT_UNAVAILABLE');if(activeIds.has(requestId))throw new ApiError(409,'NATIVE_OEX_EXPORT_BUSY');activeIds.add(requestId);
  const controller=new AbortController();controllers.add(controller);let receipt:Receipt|undefined,authEntered=false,uncertain=false,drained=false,disposed=false,owned:Owned|undefined,opened:Awaited<ReturnType<typeof open>>|undefined,knownFile:{dev:bigint;ino:bigint}|undefined,stage:string|undefined,stageDev:bigint|undefined,stageIno:bigint|undefined;
  const abort=()=>controller.abort(),closed=()=>{if(!reply.raw.writableFinished)abort();};req.raw.once('aborted',abort);reply.raw.once('close',closed);if(req.raw.aborted||reply.raw.destroyed)abort();
  const csrf=typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined;
  const work=(async()=>{
   const dispose=async()=>{
    if(opened)await opened.close();
    if(stage){const ds=await lstat(stage,{bigint:true}).catch(()=>undefined);if(!ds||ds.dev!==stageDev||ds.ino!==stageIno||!ds.isDirectory())throw new ApiError(409,'NATIVE_OEX_EXPORT_STAGE_UNCERTAIN');
     const path=join(stage,'archive.oex'),file=await lstat(path,{bigint:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
     if(file){if(!knownFile||!file.isFile()||file.dev!==knownFile.dev||file.ino!==knownFile.ino)throw new ApiError(409,'NATIVE_OEX_EXPORT_FILE_UNCERTAIN');await unlink(path);}await rmdir(stage);
    }
   };
   try{
    owned=await auth.requestForExportPreparation(token(req),p.tenantId,csrf,async(c:PoolClient,s:Session)=>{
     if(context.workspaceId!==context.workspaceId.toLowerCase()||s.tenantId!==context.tenantId||s.userId!==context.principalId)throw new ApiError(403,'FORBIDDEN');authEntered=true;
     if(latest){if(latest.operationId===requestId)throw new ApiError(409,'NATIVE_OEX_EXPORT_EXISTING');if(latest.state==='pending'||latest.state==='uncertain'||latest.sessionId===s.id&&latest.role===s.role&&!latest.observed)throw new ApiError(409,'NATIVE_OEX_EXPORT_BUSY');}
     receipt={operationId:requestId,tenantId:p.tenantId,userId:s.userId,sessionId:s.id,role:s.role,exhibitionId:p.id,etag:match,bytes:0,sha256:'',omitted:[],state:'pending',observed:false};latest=receipt;await context.assertDatabase(c);controller.signal.throwIfAborted();
     const root=await realpath(blobRoot),parent=await realpath(dirname(root));if(root!==blobRoot||dirname(root)!==parent)throw new ApiError(409,'NATIVE_OEX_EXPORT_UNAVAILABLE');
     const ps=await lstat(parent);if(!ps.isDirectory()||ps.isSymbolicLink()||ps.uid!==process.getuid?.()||(ps.mode&0o077)!==0)throw new ApiError(409,'NATIVE_OEX_EXPORT_UNAVAILABLE');
     const capacity=await statfs(parent,{bigint:true});if(capacity.bavail*capacity.bsize<BigInt(MAX+RESERVE))throw new ApiError(409,'NATIVE_OEX_EXPORT_CAPACITY');
     const directory=join(parent,`native-oex-export-${context.workspaceId}`);try{await mkdir(directory,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST'){uncertain=true;throw new ApiError(409,'NATIVE_OEX_EXPORT_BUSY');}throw error;}
     stage=directory;const ds=await lstat(directory,{bigint:true});stageDev=ds.dev;stageIno=ds.ino;if(!ds.isDirectory()||ds.isSymbolicLink()||ds.uid!==BigInt(process.getuid?.()??-1)||(ds.mode&0o077n)!==0n)throw Error('NATIVE_OEX_EXPORT_STAGE');
     const path=join(directory,'archive.oex'),result=await oex.exportBoundedFile(c,s,p.id,match,path,controller.signal,progress=>{if(receipt)receipt.progress=progress;});
     const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);opened=handle;
      const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid?.()??-1)||(before.mode&0o077n)!==0n||before.size<1n||before.size>BigInt(MAX)||before.size!==BigInt(result.bytes))throw Error('NATIVE_OEX_EXPORT_FILE');
      knownFile={dev:before.dev,ino:before.ino};controller.signal.throwIfAborted();result.checkRights();
      const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0;while(offset<result.bytes){controller.signal.throwIfAborted();const r=await handle.read(buffer,0,Math.min(buffer.length,result.bytes-offset),offset);if(!r.bytesRead)throw Error('NATIVE_OEX_EXPORT_SHORT');hash.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
      const after=await handle.stat({bigint:true});if(after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs)throw Error('NATIVE_OEX_EXPORT_CHANGED');
      await context.assertDatabase(c);controller.signal.throwIfAborted();owned={stage:directory,path,stageDev:ds.dev,stageIno:ds.ino,fileDev:before.dev,fileIno:before.ino,bytes:result.bytes,sha256:hash.digest('hex'),handle,mtimeNs:before.mtimeNs,ctimeNs:before.ctimeNs,omitted:result.omittedImported,sessionId:s.id,role:s.role};return owned;
    });
    controller.signal.throwIfAborted();const selected=owned;
    const authority=await auth.request(token(req),p.tenantId,csrf,true,async(c,s)=>{if(s.id!==selected.sessionId||s.role!==selected.role||s.tenantId!==context.tenantId||s.userId!==context.principalId)throw new ApiError(403,'FORBIDDEN');await context.assertDatabase(c);const checkRights=await oex.revalidateBoundedExport(c,s,p.id,match,selected.omitted);controller.signal.throwIfAborted();return {expiresAt:s.expiresAt,checkRights};});
    if(!Number.isFinite(Date.parse(authority.expiresAt))||Date.now()>=Date.parse(authority.expiresAt))throw new ApiError(401,'AUTH_REQUIRED');authority.checkRights();const directory=await lstat(selected.stage,{bigint:true});if(directory.dev!==selected.stageDev||directory.ino!==selected.stageIno||!directory.isDirectory())throw new ApiError(409,'NATIVE_OEX_EXPORT_STAGE_UNCERTAIN');
    const st=await selected.handle.stat({bigint:true}),named=await lstat(selected.path,{bigint:true});if(st.dev!==selected.fileDev||st.ino!==selected.fileIno||named.dev!==selected.fileDev||named.ino!==selected.fileIno||st.size!==BigInt(selected.bytes)||st.mtimeNs!==selected.mtimeNs||st.ctimeNs!==selected.ctimeNs)throw Error('NATIVE_OEX_EXPORT_CHANGED');
    controller.signal.throwIfAborted();if(Date.now()>=Date.parse(authority.expiresAt))throw new ApiError(401,'AUTH_REQUIRED');authority.checkRights();if(!receipt||receipt!==latest||receipt.sessionId!==selected.sessionId)throw new ApiError(409,'NATIVE_OEX_EXPORT_UNAVAILABLE');receipt.bytes=selected.bytes;receipt.sha256=selected.sha256;receipt.omitted=selected.omitted;reply.hijack();reply.raw.writeHead(200,{'content-type':'application/vnd.exhibitos.oex+zip','content-disposition':'attachment; filename="exhibition.oex"','content-length':String(selected.bytes),'cache-control':'no-store','x-exhibitos-oex-profile':'bounded-file-v1','x-exhibitos-oex-sha256':selected.sha256,'x-exhibitos-oex-operation':receipt.operationId,'x-content-type-options':'nosniff'});
    await pipeline(selected.handle.createReadStream({autoClose:false,start:0,end:selected.bytes-1}),reply.raw,{signal:controller.signal});const finalStat=await selected.handle.stat({bigint:true});if(finalStat.dev!==selected.fileDev||finalStat.ino!==selected.fileIno||finalStat.size!==BigInt(selected.bytes)||finalStat.mtimeNs!==selected.mtimeNs||finalStat.ctimeNs!==selected.ctimeNs)throw Error('NATIVE_OEX_EXPORT_CHANGED');drained=true;
   }catch(error){if(!authEntered&&latest?.operationId!==requestId&&!reply.raw.headersSent){reply.header('x-exhibitos-oex-operation',requestId).header('x-exhibitos-oex-admission','attempt-not-admitted');}if(controller.signal.aborted||reply.raw.headersSent)reply.raw.destroy();throw error;}
   finally{
    req.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed);controllers.delete(controller);
    await dispose();disposed=!uncertain;
   }
  })();active.add(work);try{await work;}finally{active.delete(work);activeIds.delete(requestId);if(receipt)receipt.state=drained&&disposed?'complete':disposed?'failed':'uncertain';}return reply;
 });
 type ReceiptParams={tenantId:string;id:string;operationId:string};
 function checkReceipt(receipt:Receipt|undefined,p:ReceiptParams,match:string,s:Session):asserts receipt is Receipt {
   if(!receipt||receipt!==latest||receipt.operationId!==p.operationId||receipt.tenantId!==p.tenantId||receipt.exhibitionId!==p.id||receipt.etag!==match||receipt.sessionId!==s.id||receipt.userId!==s.userId||receipt.role!==s.role||s.tenantId!==context.tenantId||s.userId!==context.principalId)throw new ApiError(404,'NATIVE_OEX_EXPORT_NOT_FOUND');
 }
 app.get('/api/v1/tenants/:tenantId/studio/exhibitions/:id/native-oex/exports/:operationId/progress',async(req,reply)=>{
  guard(req,false);reply.header('cache-control','no-store');
  const p=req.params as ReceiptParams;uuid(p.tenantId);uuid(p.id);uuid(p.operationId);
  const match=requiredMatch(req.headers['if-match']),receipt=latest;
  const result=await auth.request(token(req),p.tenantId,undefined,false,async(c,s)=>{
   checkReceipt(receipt,p,match,s);
   if(receipt.state!=='pending'||!receipt.progress)throw new ApiError(404,'NATIVE_OEX_EXPORT_NOT_FOUND');
   await context.assertDatabase(c);
   return {expiresAt:s.expiresAt,progress:receipt.progress};
  });
  if(receipt!==latest||receipt?.state!=='pending')throw new ApiError(404,'NATIVE_OEX_EXPORT_NOT_FOUND');
  if(!Number.isFinite(Date.parse(result.expiresAt))||Date.now()>=Date.parse(result.expiresAt))throw new ApiError(401,'AUTH_REQUIRED');
  return {operationId:receipt.operationId,state:'pending',progress:result.progress};
 });
 app.get('/api/v1/tenants/:tenantId/studio/exhibitions/:id/native-oex/exports/:operationId',async(req,reply)=>{
  guard(req,false);reply.header('cache-control','no-store');const p=req.params as {tenantId:string;id:string;operationId:string};uuid(p.tenantId);uuid(p.id);uuid(p.operationId);const match=requiredMatch(req.headers['if-match']),receipt=latest;
  const result=await auth.request(token(req),p.tenantId,undefined,false,async(c,s)=>{
   checkReceipt(receipt,p,match,s);
   await context.assertDatabase(c);const state=receipt.state;if(state==='complete'){try{const checkRights=await oex.revalidateBoundedExport(c,s,p.id,match,receipt.omitted);return {expiresAt:s.expiresAt,state,checkRights,denied:false};}catch(error){if(!(error instanceof ApiError)||!['REMOTE_CONFLICT','OEX_SOURCE_CHANGED','RIGHTS_DENIED','FORBIDDEN','COVER_IMAGE_RIGHTS_DENIED','COVER_IMAGE_APPROVAL_CHANGED','DRAFT_CORRUPT'].includes(error.code))throw error;return {expiresAt:s.expiresAt,state,denied:true};}}return {expiresAt:s.expiresAt,state,denied:false};
  });
  if(receipt!==latest||!receipt)throw new ApiError(404,'NATIVE_OEX_EXPORT_NOT_FOUND');if(!Number.isFinite(Date.parse(result.expiresAt))||Date.now()>=Date.parse(result.expiresAt))throw new ApiError(401,'AUTH_REQUIRED');
  if(result.state!==receipt.state)return {operationId:receipt.operationId,state:'pending'};if(result.state==='complete'){let denied=result.denied;try{result.checkRights?.();}catch(error){if(!(error instanceof ApiError))throw error;denied=true;}receipt.observed=true;if(denied)return {operationId:receipt.operationId,state:'failed'};return {operationId:receipt.operationId,state:result.state,etag:receipt.etag,bytes:receipt.bytes,sha256:receipt.sha256};}if(result.state==='failed')receipt.observed=true;return {operationId:receipt.operationId,state:result.state};
 });
}
