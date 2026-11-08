// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {finished} from 'node:stream/promises';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {revisionHash} from '@exhibitos/spec';
import {ARTWORK_DETAIL_QUALITY_NAMESPACE,freezeCanonical} from '@exhibitos/studio-contract';
import {parseStaticJson} from '../../web/src/static-json.mjs';
import {Auth,ApiError,type Session} from './auth.ts';
import {NativeDetailOperations,type NativeDetailScope} from './native-detail-static-export.ts';
import type {NativeLocalExportContext} from './native-oex-provenance.ts';
import type {PoolClient} from 'pg';

type Context={owner:NativeLocalExportContext;runtimeGeneration:string;live:()=>boolean};
type Dependencies={auth:Auth;context:Context;guard:(request:FastifyRequest,mutate:boolean)=>void;token:(request:FastifyRequest)=>string|undefined};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,hex=/^[a-f0-9]{64}$/;
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const invalid=()=>{throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');};
const emptyDigest=createHash('sha256').update(freezeCanonical([])).digest('hex');

/** Native-only control for the currently supported empty candidate set. An
 * actual source/inspector adapter is still required before any detail bytes
 * can be admitted. Never mount without an issued live native owner context. */
export function registerNativeDetailHttp(app:FastifyInstance,{auth,context,guard,token}:Dependencies){
 const registry=new NativeDetailOperations();
 app.addHook('preClose',async()=>{void registry.closeRuntime();});
 app.addHook('onClose',async()=>{if(!await registry.closeRuntime())throw Error('NATIVE_DETAIL_DRAIN_UNCERTAIN');});
 app.register(async scoped=>{
  scoped.removeContentTypeParser('application/json');
  scoped.addContentTypeParser('application/json',{parseAs:'buffer',bodyLimit:4096},(_req,body,done)=>{try{done(null,parseStaticJson(body as Buffer,4096));}catch{done(new ApiError(400,'INVALID_INPUT'));}});
  const prefix='/api/v1/tenants/:tenantId/studio/publications/:publicationId/native-detail-export';
  const live=async(c:PoolClient,s:Session)=>{if(!context.live()||s.tenantId!==context.owner.tenantId||s.userId!==context.owner.principalId)invalid();await context.owner.assertDatabase(c);if(!context.live())invalid();};
  const identity=(s:Session,publicationId:string)=>({runtimeGeneration:context.runtimeGeneration,workspaceId:context.owner.workspaceId,tenantId:s.tenantId,principalId:s.userId,sessionId:s.id,publicationId});
  const authenticated=async<T>(request:FastifyRequest,work:(c:PoolClient,s:Session)=>Promise<T>)=>{const p=request.params as {tenantId:string;publicationId:string};if(!uuid.test(p.tenantId)||!uuid.test(p.publicationId))throw new ApiError(400,'INVALID_INPUT');const read=request.method==='GET';guard(request,!read);if(read&&typeof request.headers.origin!=='string')throw new ApiError(403,'ORIGIN_REJECTED');return auth.requestForNativeDetailRead(token(request),p.tenantId,typeof request.headers['x-csrf-token']==='string'?request.headers['x-csrf-token']:undefined,async(c,s)=>{await live(c,s);return work(c,s);});};
  const normalize=(error:unknown):never=>{if(error instanceof Error&&error.message==='NATIVE_DETAIL_BUSY')throw new ApiError(409,'NATIVE_DETAIL_BUSY');if(error instanceof Error&&error.message==='NATIVE_DETAIL_UNAVAILABLE')throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');throw error;};
  const checkedBody=(request:FastifyRequest,keys:string[])=>{const body=request.body;if(!exact(body,keys)||body.version!==1||typeof body.jobId!=='string'||!uuid.test(body.jobId)||typeof body.revisionSha256!=='string'||!hex.test(body.revisionSha256))throw new ApiError(400,'INVALID_INPUT');return body;};
  const publication=async(c:PoolClient,s:Session,publicationId:string,revision:string)=>{
   const row=(await c.query("SELECT p.*,st.status,e.studio_owner_user_id FROM studio_publications p JOIN publication_states st ON st.publication_id=p.id JOIN exhibitions e ON (e.tenant_id,e.id)=(p.tenant_id,p.exhibition_id) WHERE p.tenant_id=$1 AND p.id=$2 AND e.deleted_at IS NULL",[s.tenantId,publicationId])).rows[0];
   if(!row||row.status!=='published'||row.studio_owner_user_id!==s.userId||row.revision_sha256!==revision||revisionHash(row.snapshot)!==revision||!Array.isArray(row.snapshot?.artworks))invalid();
   // No approved whole-file inspector or cost model is registered yet.
   if(row.snapshot.artworks.some((artwork:{extensions?:Record<string,unknown>})=>artwork.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE]!==undefined))invalid();
  };
  const scopedRequest=(phase:'prepare'|'final')=>async(request:FastifyRequest,reply:import('fastify').FastifyReply)=>{
   reply.header('cache-control','no-store');const keys=phase==='prepare'?['version','jobId','revisionSha256']:['version','jobId','revisionSha256','detailCount','detailSetSha256'],body=checkedBody(request,keys),p=request.params as {publicationId:string};
   if(phase==='final'&&(body.detailCount!==0||body.detailSetSha256!==emptyDigest))invalid();
   const disconnected=new AbortController();let bound:NativeDetailScope|undefined;
   const abort=()=>{disconnected.abort();if(bound)try{registry.close(bound);}catch{/* Unobservable cleanup stays unconfirmed. */}};
   const closed=()=>{if(!reply.raw.writableFinished)abort();};request.raw.once('aborted',abort);reply.raw.once('close',closed);if(request.raw.aborted||reply.raw.destroyed)abort();
   try{
    bound=await authenticated(request,async(_c,s)=>({...identity(s,p.publicationId),revisionSha256:body.revisionSha256 as string,jobId:body.jobId as string}));
    if(disconnected.signal.aborted){registry.close(bound);invalid();}
    await registry.run(bound,phase,async signal=>{
     const owner=bound!;await authenticated(request,async(c,s)=>{if(s.id!==owner.sessionId||!context.live())invalid();signal.throwIfAborted();await publication(c,s,p.publicationId,owner.revisionSha256);await live(c,s);signal.throwIfAborted();});
     const response=phase==='prepare'?{version:1,publicationId:p.publicationId,revisionSha256:owner.revisionSha256,detailAssets:[]}:{version:1,publicationId:p.publicationId,revisionSha256:owner.revisionSha256,valid:true};
     signal.throwIfAborted();reply.hijack();reply.raw.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});reply.raw.end(JSON.stringify(response));await finished(reply.raw);
    },async()=>{});
    return reply;
   }catch(error){if(reply.raw.headersSent)reply.raw.destroy();return normalize(error);}finally{request.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed);}
  };
  scoped.post(`${prefix}/prepare`,{bodyLimit:4096},scopedRequest('prepare'));
  scoped.post(`${prefix}/final-check`,{bodyLimit:4096},scopedRequest('final'));
  scoped.post(`${prefix}/close`,{bodyLimit:4096},async(request,reply)=>{reply.header('cache-control','no-store');const body=checkedBody(request,['version','jobId','revisionSha256']),p=request.params as {publicationId:string};try{await authenticated(request,async(_c,s)=>{registry.close({...identity(s,p.publicationId),revisionSha256:body.revisionSha256 as string,jobId:body.jobId as string});});}catch(error){return normalize(error);}return {version:1,jobId:body.jobId,state:'closing'};});
  scoped.get(`${prefix}/operations/:jobId`,async(request,reply)=>{reply.header('cache-control','no-store');const p=request.params as {publicationId:string;jobId:string};if(!uuid.test(p.jobId))throw new ApiError(400,'INVALID_INPUT');try{return await authenticated(request,async(_c,s)=>{const found=registry.lookup(identity(s,p.publicationId),p.jobId);return {version:1,jobId:p.jobId,publicationId:p.publicationId,revisionSha256:found.revisionSha256,runtimeGeneration:found.runtimeGeneration,state:registry.status(found)};});}catch(error){return normalize(error);}});
 });
}
