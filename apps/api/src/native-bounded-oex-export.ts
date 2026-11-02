// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath,rmdir,statfs,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {Auth,ApiError,uuid,type AuthConfig,type Session} from './auth.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {requiredMatch} from './studio.ts';
import type {ImportedPreviewOmission,Oex} from './oex.ts';

const MAX=512*1024*1024,RESERVE=1024*1024*1024;
type Owned={stage:string;path:string;stageDev:bigint;stageIno:bigint;fileDev:bigint;fileIno:bigint;bytes:number;sha256:string;handle:Awaited<ReturnType<typeof open>>;mtimeNs:bigint;ctimeNs:bigint;omitted:ImportedPreviewOmission[];sessionId:string;role:string};
/** Local native owner only. The ordinary origin, cookie and CSRF checks are
 * supplied by the existing Auth instance; neither paths nor owner identity are
 * accepted from the request. An uncertain stage is never adopted. */
export function registerNativeBoundedOexExport(app:FastifyInstance,input:{auth:Auth;config:AuthConfig;context:NativeOexWorkspaceContext;blobRoot:string;oex:Oex;guard:(req:FastifyRequest)=>void;token:(req:FastifyRequest)=>string|undefined}){
 const {auth,context,blobRoot,oex,guard,token}=input;if(input.config.mode!=='local')throw Error('NATIVE_OEX_EXPORT_CONFIGURATION');
 const active=new Set<Promise<void>>(),controllers=new Set<AbortController>();let closing=false;
 app.addHook('preClose',async()=>{closing=true;for(const controller of controllers)controller.abort();});
 app.addHook('onClose',async()=>{await Promise.allSettled([...active]);});
 app.post('/api/v1/tenants/:tenantId/studio/exhibitions/:id/native-oex/export',{schema:{body:{type:'object',additionalProperties:false,maxProperties:0}}},async(req,reply)=>{
  guard(req);reply.header('cache-control','no-store');const p=req.params as {tenantId:string;id:string};uuid(p.tenantId);uuid(p.id);const match=requiredMatch(req.headers['if-match']);
  if(closing)throw new ApiError(409,'NATIVE_OEX_EXPORT_UNAVAILABLE');
  const controller=new AbortController();controllers.add(controller);let owned:Owned|undefined,opened:Awaited<ReturnType<typeof open>>|undefined,knownFile:{dev:bigint;ino:bigint}|undefined,stage:string|undefined,stageDev:bigint|undefined,stageIno:bigint|undefined;
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
    owned=await auth.request(token(req),p.tenantId,csrf,true,async(c:PoolClient,s:Session)=>{
     if(context.workspaceId!==context.workspaceId.toLowerCase()||s.tenantId!==context.tenantId||s.userId!==context.principalId)throw new ApiError(403,'FORBIDDEN');await context.assertDatabase(c);controller.signal.throwIfAborted();
     const root=await realpath(blobRoot),parent=await realpath(dirname(root));if(root!==blobRoot||dirname(root)!==parent)throw new ApiError(409,'NATIVE_OEX_EXPORT_UNAVAILABLE');
     const ps=await lstat(parent);if(!ps.isDirectory()||ps.isSymbolicLink()||ps.uid!==process.getuid?.()||(ps.mode&0o077)!==0)throw new ApiError(409,'NATIVE_OEX_EXPORT_UNAVAILABLE');
     const capacity=await statfs(parent,{bigint:true});if(capacity.bavail*capacity.bsize<BigInt(MAX+RESERVE))throw new ApiError(409,'NATIVE_OEX_EXPORT_CAPACITY');
     const directory=join(parent,`native-oex-export-${context.workspaceId}`);try{await mkdir(directory,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new ApiError(409,'NATIVE_OEX_EXPORT_BUSY');throw error;}
     stage=directory;const ds=await lstat(directory,{bigint:true});stageDev=ds.dev;stageIno=ds.ino;if(!ds.isDirectory()||ds.isSymbolicLink()||ds.uid!==BigInt(process.getuid?.()??-1)||(ds.mode&0o077n)!==0n)throw Error('NATIVE_OEX_EXPORT_STAGE');
     const path=join(directory,'archive.oex'),result=await oex.exportBoundedFile(c,s,p.id,match,path,controller.signal);
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
    controller.signal.throwIfAborted();if(Date.now()>=Date.parse(authority.expiresAt))throw new ApiError(401,'AUTH_REQUIRED');authority.checkRights();reply.hijack();reply.raw.writeHead(200,{'content-type':'application/vnd.exhibitos.oex+zip','content-disposition':'attachment; filename="exhibition.oex"','content-length':String(selected.bytes),'cache-control':'no-store','x-exhibitos-oex-profile':'bounded-file-v1','x-exhibitos-oex-sha256':selected.sha256,'x-content-type-options':'nosniff'});
    await pipeline(selected.handle.createReadStream({autoClose:false,start:0,end:selected.bytes-1}),reply.raw,{signal:controller.signal});if(!reply.raw.writableFinished)throw Error('NATIVE_OEX_EXPORT_DRAIN');const drained=await selected.handle.stat({bigint:true});if(drained.dev!==selected.fileDev||drained.ino!==selected.fileIno||drained.size!==BigInt(selected.bytes)||drained.mtimeNs!==selected.mtimeNs||drained.ctimeNs!==selected.ctimeNs)throw Error('NATIVE_OEX_EXPORT_CHANGED');
   }catch(error){if(controller.signal.aborted||reply.raw.headersSent)reply.raw.destroy();throw error;}
   finally{
    req.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed);controllers.delete(controller);
    await dispose();
   }
  })();active.add(work);try{await work;}finally{active.delete(work);}return reply;
 });
}
