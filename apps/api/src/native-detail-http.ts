// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {finished} from 'node:stream/promises';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {revisionHash} from '@exhibitos/spec';
import {ARTWORK_DETAIL_QUALITY_NAMESPACE,freezeCanonical} from '@exhibitos/studio-contract';
import {parseStaticJson} from '../../web/src/static-json.mjs';
import {Auth,ApiError,type Session} from './auth.ts';
import {NativeDetailOperations,type NativeDetailScope} from './native-detail-static-export.ts';
import {isIssuedNativeDetailContext,type NativeDetailContext} from './native-detail-context.ts';
import {reconstructNativeOriginalExport} from './native-original-export-plan.ts';
import type {Studio} from './studio.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import type {FileBlobStore} from '@exhibitos/storage';
import type {PoolClient} from 'pg';

type Dependencies={auth:Auth;context:NativeDetailContext;guard:(request:FastifyRequest,mutate:boolean)=>void;token:(request:FastifyRequest)=>string|undefined;original?:{studio:Studio;cms:Cms;imports:Imports;blobs:FileBlobStore}};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,hex=/^[a-f0-9]{64}$/;
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const invalid=()=>{throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');};
const emptyDigest=createHash('sha256').update(freezeCanonical([])).digest('hex');

/** Native-only control and privately scoped original reads. No candidate can
 * pass until a server-owned image model is registered and qualified. */
export function registerNativeDetailHttp(app:FastifyInstance,{auth,context,guard,token,original}:Dependencies){
 if(!isIssuedNativeDetailContext(context))throw Error('NATIVE_DETAIL_CONFIGURATION');
 const registry=new NativeDetailOperations();
 const ownerLost=()=>{void registry.closeRuntime();};context.signal.addEventListener('abort',ownerLost,{once:true});if(context.signal.aborted)ownerLost();
 app.addHook('preClose',async()=>{void registry.closeRuntime();});
 app.addHook('onClose',async()=>{context.signal.removeEventListener('abort',ownerLost);if(!await registry.closeRuntime())throw Error('NATIVE_DETAIL_DRAIN_UNCERTAIN');});
 app.register(async scoped=>{
  scoped.removeContentTypeParser('application/json');
  scoped.addContentTypeParser('application/json',{parseAs:'buffer',bodyLimit:4096},(_req,body,done)=>{try{done(null,parseStaticJson(body as Buffer,4096));}catch{done(new ApiError(400,'INVALID_INPUT'));}});
  const prefix='/api/v1/tenants/:tenantId/studio/publications/:publicationId/native-detail-export';
  const live=async(c:PoolClient,s:Session)=>{if(!context.live()||s.tenantId!==context.owner.tenantId||s.userId!==context.owner.principalId||!Number.isFinite(Date.parse(s.expiresAt))||Date.now()>=Date.parse(s.expiresAt))invalid();await context.owner.assertDatabase(c);if(!context.live()||Date.now()>=Date.parse(s.expiresAt))invalid();};
  const identity=(s:Session,publicationId:string)=>({runtimeGeneration:context.runtimeGeneration,workspaceId:context.owner.workspaceId,tenantId:s.tenantId,principalId:s.userId,sessionId:s.id,publicationId});
  const authenticated=async<T>(request:FastifyRequest,work:(c:PoolClient,s:Session)=>Promise<T>)=>{const p=request.params as {tenantId:string;publicationId:string};if(!uuid.test(p.tenantId)||!uuid.test(p.publicationId))throw new ApiError(400,'INVALID_INPUT');const read=request.method==='GET';guard(request,!read);if(read&&typeof request.headers.origin!=='string')throw new ApiError(403,'ORIGIN_REJECTED');return auth.requestForNativeDetailRead(token(request),p.tenantId,typeof request.headers['x-csrf-token']==='string'?request.headers['x-csrf-token']:undefined,async(c,s)=>{await live(c,s);return work(c,s);});};
  const normalize=(error:unknown):never=>{if(error instanceof Error&&error.message==='NATIVE_DETAIL_BUSY')throw new ApiError(409,'NATIVE_DETAIL_BUSY');if(error instanceof Error&&error.message==='NATIVE_DETAIL_UNAVAILABLE')throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');throw error;};
  const checkedBody=(request:FastifyRequest,keys:string[])=>{const body=request.body;if(!exact(body,keys)||body.version!==1||typeof body.jobId!=='string'||!uuid.test(body.jobId)||typeof body.revisionSha256!=='string'||!hex.test(body.revisionSha256))throw new ApiError(400,'INVALID_INPUT');return body;};
  const publication=async(c:PoolClient,s:Session,publicationId:string,revision:string,signal:AbortSignal,selected?:{assetId:string;sourceBindingSha256:string})=>{
   if(original)return reconstructNativeOriginalExport(c,s,publicationId,revision,{context,...original},signal,selected);
   const row=(await c.query("SELECT p.*,st.status,e.studio_owner_user_id FROM studio_publications p JOIN publication_states st ON st.publication_id=p.id JOIN exhibitions e ON (e.tenant_id,e.id)=(p.tenant_id,p.exhibition_id) WHERE p.tenant_id=$1 AND p.id=$2 AND e.deleted_at IS NULL",[s.tenantId,publicationId])).rows[0];
   if(!row||row.status!=='published'||row.studio_owner_user_id!==s.userId||row.revision_sha256!==revision||revisionHash(row.snapshot)!==revision||!Array.isArray(row.snapshot?.artworks))invalid();
   // No approved whole-file inspector or cost model is registered yet.
   if(row.snapshot.artworks.some((artwork:{extensions?:Record<string,unknown>})=>artwork.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE]!==undefined))invalid();
   if(selected)invalid();return {tuples:[],descriptors:[],detailSetSha256:emptyDigest,bytes:undefined};
  };
  const scopedRequest=(phase:'prepare'|'final')=>async(request:FastifyRequest,reply:import('fastify').FastifyReply)=>{
   reply.header('cache-control','no-store');const keys=phase==='prepare'?['version','jobId','revisionSha256']:['version','jobId','revisionSha256','detailCount','detailSetSha256'],body=checkedBody(request,keys),p=request.params as {publicationId:string};
   if(phase==='final'&&(!Number.isSafeInteger(body.detailCount)||Number(body.detailCount)<0||Number(body.detailCount)>16||typeof body.detailSetSha256!=='string'||!hex.test(body.detailSetSha256)))throw new ApiError(400,'INVALID_INPUT');
   const disconnected=new AbortController();let bound:NativeDetailScope|undefined,hijacked=false;
   const abort=()=>{disconnected.abort();if(bound)try{registry.close(bound);}catch{/* Unobservable cleanup stays unconfirmed. */}};
   const closed=()=>{if(!reply.raw.writableFinished)abort();};request.raw.once('aborted',abort);reply.raw.once('close',closed);if(request.raw.aborted||reply.raw.destroyed)abort();
   try{
    bound=await authenticated(request,async(_c,s)=>({...identity(s,p.publicationId),revisionSha256:body.revisionSha256 as string,jobId:body.jobId as string}));
    if(disconnected.signal.aborted){registry.close(bound);invalid();}
    await registry.run(bound,phase,async signal=>{
     const owner=bound!;await authenticated(request,async(c,s)=>{if(s.id!==owner.sessionId||!context.live())invalid();signal.throwIfAborted();const plan=await publication(c,s,p.publicationId,owner.revisionSha256,signal);await live(c,s);signal.throwIfAborted();
      if(phase==='final'&&(body.detailCount!==plan.tuples.length||body.detailSetSha256!==plan.detailSetSha256))invalid();
      const response=phase==='prepare'?{version:1,publicationId:p.publicationId,revisionSha256:owner.revisionSha256,detailAssets:plan.descriptors}:{version:1,publicationId:p.publicationId,revisionSha256:owner.revisionSha256,valid:true};
      const stopResponse=()=>{if(hijacked&&!reply.raw.destroyed)reply.raw.destroy();};signal.addEventListener('abort',stopResponse,{once:true});
      try{signal.throwIfAborted();reply.hijack();hijacked=true;const settled=finished(reply.raw);settled.catch(()=>{});
       try{if(signal.aborted)stopResponse();signal.throwIfAborted();reply.raw.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});reply.raw.end(JSON.stringify(response));await settled;await live(c,s);signal.throwIfAborted();}
       catch(error){reply.raw.destroy();await settled.catch(()=>{});throw error;}
      }finally{signal.removeEventListener('abort',stopResponse);}
     });
    },async()=>{});
    return reply;
   }catch(error){if(hijacked){reply.raw.destroy();return reply;}return normalize(error);}finally{request.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed);}
  };
  scoped.post(`${prefix}/prepare`,{bodyLimit:4096},scopedRequest('prepare'));
  scoped.post(`${prefix}/final-check`,{bodyLimit:4096},scopedRequest('final'));
  scoped.post(`${prefix}/bytes`,{bodyLimit:4096},async(request,reply)=>{
   reply.header('cache-control','no-store');const body=checkedBody(request,['version','jobId','revisionSha256','assetId','sourceBindingSha256']),p=request.params as {publicationId:string};if(typeof body.assetId!=='string'||!uuid.test(body.assetId)||typeof body.sourceBindingSha256!=='string'||!hex.test(body.sourceBindingSha256))throw new ApiError(400,'INVALID_INPUT');
   const disconnected=new AbortController();let bound:NativeDetailScope|undefined,hijacked=false;
   const abort=()=>{disconnected.abort();if(bound)try{registry.close(bound);}catch{/* Unobservable cleanup remains unconfirmed. */}};const closed=()=>{if(!reply.raw.writableFinished)abort();};request.raw.once('aborted',abort);reply.raw.once('close',closed);if(request.raw.aborted||reply.raw.destroyed)abort();
   try{bound=await authenticated(request,async(_c,s)=>({...identity(s,p.publicationId),revisionSha256:body.revisionSha256 as string,jobId:body.jobId as string}));if(disconnected.signal.aborted){registry.close(bound);invalid();}
    await registry.run(bound,'bytes',async signal=>{const owner=bound!;await authenticated(request,async(c,s)=>{if(s.id!==owner.sessionId||!context.live())invalid();signal.throwIfAborted();const plan=await publication(c,s,p.publicationId,owner.revisionSha256,signal,{assetId:body.assetId as string,sourceBindingSha256:body.sourceBindingSha256 as string}),bytes=plan.bytes,tuple=plan.tuples.find(item=>item.assetId===body.assetId);if(!bytes||!tuple)return invalid();
     try{await live(c,s);signal.throwIfAborted();const stop=()=>{if(hijacked&&!reply.raw.destroyed)reply.raw.destroy();};signal.addEventListener('abort',stop,{once:true});try{reply.hijack();hijacked=true;const settled=finished(reply.raw);settled.catch(()=>{});try{if(signal.aborted)stop();signal.throwIfAborted();reply.raw.writeHead(200,{'content-type':tuple.mime,'content-length':String(bytes.length),'x-exhibitos-sha256':tuple.sha256,'x-exhibitos-publication-revision':owner.revisionSha256,'cache-control':'no-store','x-content-type-options':'nosniff'});reply.raw.end(bytes);await settled;await live(c,s);signal.throwIfAborted();}catch(error){reply.raw.destroy();await settled.catch(()=>{});throw error;}}finally{signal.removeEventListener('abort',stop);}}finally{bytes.fill(0);}
    });},async()=>{});return reply;
   }catch(error){if(hijacked){reply.raw.destroy();return reply;}return normalize(error);}finally{request.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed);}
  });
  scoped.post(`${prefix}/close`,{bodyLimit:4096},async(request,reply)=>{reply.header('cache-control','no-store');const body=checkedBody(request,['version','jobId','revisionSha256']),p=request.params as {publicationId:string};try{await authenticated(request,async(_c,s)=>{registry.close({...identity(s,p.publicationId),revisionSha256:body.revisionSha256 as string,jobId:body.jobId as string});});}catch(error){return normalize(error);}return {version:1,jobId:body.jobId,state:'closing'};});
  scoped.get(`${prefix}/operations/:jobId`,async(request,reply)=>{reply.header('cache-control','no-store');const p=request.params as {publicationId:string;jobId:string};if(!uuid.test(p.jobId))throw new ApiError(400,'INVALID_INPUT');try{return await authenticated(request,async(_c,s)=>{const found=registry.lookup(identity(s,p.publicationId),p.jobId);return {version:1,jobId:p.jobId,publicationId:p.publicationId,revisionSha256:found.revisionSha256,runtimeGeneration:found.runtimeGeneration,state:registry.status(found)};});}catch(error){return normalize(error);}});
 });
}
