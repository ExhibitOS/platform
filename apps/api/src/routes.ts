import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import {privateFloorMaterialCatalog,readPrivateMaterialPreview} from './private-floor-material-catalog.ts';
import {MODEL_DERIVATION_SCHEMA} from './model-derivation.ts';
import {furnishingCatalog,readFurnishingBytes} from './furnishings.ts';
import {surfaceMaterialCatalog} from './surface-materials.ts';
import {furnishingAsset,type FurnishingCatalogId} from '@exhibitos/studio-contract';
import { OperationalMetrics } from './operational-metrics.ts';
import { Privacy } from './privacy.ts';
import { Preservation } from './preservation.ts';
import { Assistance } from './assistance.ts';
import { Federation, type FederationConfig } from './federation.ts';
import { transaction } from '@exhibitos/storage';
import { Institution, type InstitutionPrincipal } from './institution.ts';
import { authorizeProcessingInput } from './processing-authorization.ts';
import { Audio, MAX_AUDIO, type AudioInput } from './audio.ts';
import {CoverImages,type CoverImageInput} from './cover-images.ts';
import {ArtworkThumbnailReceipts} from './artwork-thumbnail-receipts.ts';
import {MAX_SPACE_STILL_BYTES} from '@exhibitos/spec/space-still';
import { Publications } from './publication.ts';
import { registerRealtime } from './realtime.ts';
import { registerOpening } from './opening.ts';
import { openingHostAuthority } from './opening-authority.ts';
import { Studio, etag, requiredMatch, type StudioInput } from './studio.ts';
import {NativeLocalPublicationStage} from './native-local-publication-stage.ts';
import {createNativeOriginalPublication} from './native-original-publication.ts';
import {hasQualifiedOriginalImageModel} from './native-original-image-model.ts';
import { Cms, type ArtworkMetadata } from './cms.ts';
import { Imports, MAX_UPLOAD, type ImportInput } from './imports.ts';
import {MAX_PREPARED_IMAGE_BYTES,PREPARED_IMAGE_SCHEMA} from './prepared-image.ts';
import {IMAGE_COARSE_INTENT_SCHEMA} from './image-coarse-intent.ts';
import {replaceApprovedArtwork,type ArtworkReplacementInput} from './artwork-replacement.ts';
import {approveOriginalStaticSource,type OriginalStaticApprovalInput} from './artwork-original-static-approval.ts';
import { Freezes, type FreezeConfig } from './freeze.ts';
import { Integrities } from './integrity.ts';
import { fileURLToPath } from 'node:url';
import { Oex, MAX_OEX_UPLOAD, type OexInput } from './oex.ts';
import {FileBlobStore} from '@exhibitos/storage';
import {registerSelectedNativeOexUploadSlot,type NativeBoundedUploadSlot} from './native-bounded-oex-upload.ts';
import {registerSelectedStudioPutGate,runSelectedStudioPut,type SelectedStudioPutSlot} from './native-selected-studio-put.ts';
import {registerNativeBoundedOexExport} from './native-bounded-oex-export.ts';
import {registerNativeDetailHttp} from './native-detail-http.ts';
import {isIssuedNativeDetailContext} from './native-detail-context.ts';
import {isIssuedNativeHayesCaller} from './native-hayes-caller.ts';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { Auth, ApiError, config, uuid, roles, subjectInput, passwordInput, type AuthConfig, type Session, type Role } from './auth.ts';
import type { Pool, PoolClient } from 'pg';
export function registerAuth(app:FastifyInstance,pool:Pool,input:AuthConfig,store?:import('@exhibitos/storage').BlobStore,oexWorker=false,freezeConfig?:FreezeConfig,federationConfig?:FederationConfig,publicationSource?:import('./publication.ts').PublicationSource,freshOexTest=false,uploadSlot?:NativeBoundedUploadSlot,saveSlot?:SelectedStudioPutSlot,nativeOexWorkspace?:import('./native-oex-provenance.ts').NativeOexWorkspaceContext,nativeBoundedEditing=false,nativeExportWorkspace?:import('./native-oex-provenance.ts').NativeLocalExportContext,workspaceMaterial?:WorkspaceMaterialIntakes,selectedWorkspaceMaterial?:WorkspaceMaterialIntakes,workspaceFurnishing?:WorkspaceFurnishingIntakes,runtimeAvailable?:()=>boolean,deferredStartup?:Array<()=>Promise<void>>,nativeDetailContext?:import('./native-detail-context.ts').NativeDetailContext,nativeHayesCaller?:import('./native-hayes-caller.ts').NativeHayesCaller) {
 if(nativeBoundedEditing&&(!nativeOexWorkspace||freshOexTest||input.mode!=='local')||nativeExportWorkspace&&(freshOexTest||input.mode!=='local'))throw Error('NATIVE_BOUNDED_EDIT_CONFIGURATION');
 if(nativeDetailContext&&(!isIssuedNativeDetailContext(nativeDetailContext)||nativeDetailContext.owner!==nativeExportWorkspace||!(store instanceof FileBlobStore)||!nativeDetailContext.owner.matchesBlobRoot?.(store.root)||input.mode!=='local'||freshOexTest))throw Error('NATIVE_DETAIL_CONFIGURATION');
 if(nativeHayesCaller&&(input.mode!=='local'||freshOexTest||!(store instanceof FileBlobStore)||!nativeOexWorkspace?.matchesBlobRoot?.(store.root)||typeof runtimeAvailable!=='function'||!isIssuedNativeHayesCaller(nativeHayesCaller,nativeOexWorkspace,store)))throw Error('HAYES_OWNER_CONFIGURATION');
 if(selectedWorkspaceMaterial&&(!(selectedWorkspaceMaterial instanceof WorkspaceMaterialIntakes)||!freshOexTest||input.mode!=='local'||workspaceMaterial||!(store instanceof FileBlobStore)||!nativeOexWorkspace?.workspaceMaterials||!selectedWorkspaceMaterial.matchesBinding(nativeOexWorkspace,store)))throw Error('WORKSPACE_MATERIAL_CONFIGURATION');
 const settings=config(input), auth=new Auth(pool),studio=new Studio(nativeOexWorkspace,nativeBoundedEditing,workspaceMaterial,workspaceFurnishing),selectedStudio=selectedWorkspaceMaterial?new Studio(nativeOexWorkspace,false,selectedWorkspaceMaterial):studio;
 if(freshOexTest){if(!(store instanceof FileBlobStore)||!uploadSlot||!saveSlot)throw Error('OEX_TEST_CONFIGURATION');registerSelectedStudioPutGate(app,auth,input,selectedStudio,saveSlot,!!nativeOexWorkspace);registerSelectedNativeOexUploadSlot(app,auth,input,store,uploadSlot);}
 const token=(req:FastifyRequest) => {
  const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${settings.cookieName}=`));
  return cookies.length===1 ? cookies[0]!.slice(settings.cookieName.length+1) : undefined;
 };
 const cookie=(value:string,clear=false)=>`${settings.cookieName}=${value}; Path=/; HttpOnly; SameSite=${settings.clientOrigin && settings.clientOrigin !== settings.origin ? 'None' : 'Strict'}; Max-Age=${clear?0:28800}${settings.secure?'; Secure':''}`;
 const guarded=(req:FastifyRequest,mutate:boolean)=>{
  if(req.headers.host!==settings.host) throw new ApiError(403,'ORIGIN_REJECTED');
  if(req.headers.origin!==undefined && req.headers.origin!==settings.origin && (!settings.clientOrigin || req.headers.origin!==settings.clientOrigin)) throw new ApiError(403,'ORIGIN_REJECTED');
  if(mutate && req.headers.origin!==settings.origin && (!settings.clientOrigin || req.headers.origin!==settings.clientOrigin)) throw new ApiError(403,'ORIGIN_REJECTED');
  if(mutate && req.method!=='POST' && req.method!=='PUT' && req.method!=='PATCH') throw new ApiError(400,'INVALID_INPUT');
 };
 app.setErrorHandler((error,request,reply)=>{
  const framework=error as {validation?:unknown;statusCode?:number};
  const status=error instanceof ApiError ? error.status : framework.validation || framework.statusCode===400 ? 400 : framework.statusCode===413 ? 413 : framework.statusCode===415 ? 415 : 500;
  const code=error instanceof ApiError ? error.code : status===400?'INVALID_INPUT':status===413?'BODY_TOO_LARGE':status===415?'UNSUPPORTED_MEDIA_TYPE':'INTERNAL_ERROR';
  return reply.code(status).send({code,message:code,fieldErrors:[],requestId:request.id});
 });
 const str={type:'string'}, id={type:'string',format:'uuid'};
 const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
 const bodyMetadata=object({revision:{type:'integer',minimum:1},metadata:{type:'object',maxProperties:200}});
 app.post('/api/v1/auth/login',{schema:{body:object({subject:{...str,minLength:3,maxLength:128},password:{...str,minLength:12,maxLength:1024},tenantId:id})}},async(req,reply)=>{
  guarded(req,true);
  const body=req.body as {subject:string;password:string;tenantId:string};
  const result=await auth.login(body.subject,body.password,body.tenantId,req.ip);
  return reply.header('set-cookie',cookie(result.token)).header('cache-control','no-store').send({authenticated:true});
 });
 const call=(mutate:boolean,work:(client:PoolClient,s:Session,req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
  guarded(req,mutate);
  reply.header('cache-control','no-store');
  const params=req.params as {tenantId?:string};
  if(params.tenantId) uuid(params.tenantId);
  return auth.request(token(req),params.tenantId,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined,mutate,(client,s)=>work(client,s,req,reply));
 };
 const nativeMutation=(work:(client:PoolClient,s:Session,req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
  guarded(req,true);reply.header('cache-control','no-store');const tenantId=(req.params as {tenantId:string}).tenantId;uuid(tenantId);
  return auth.requestForNativeWorkspaceMutation(token(req),tenantId,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined,(client,s)=>work(client,s,req,reply));
 };
 app.get('/api/v1/auth/session',call(false,async(c,s)=>{let result:Record<string,unknown>={...s};if(nativeExportWorkspace&&store instanceof FileBlobStore&&s.tenantId===nativeExportWorkspace.tenantId&&s.userId===nativeExportWorkspace.principalId){try{await nativeExportWorkspace.assertDatabase(c);result={...result,nativeOexExportProfile:'bounded-file-v1',nativePublicationProfile:'bounded-local-v1'};}catch{/* Keep the existing session usable without advertising an unavailable route. */}}if(workspaceMaterial)try{await workspaceMaterial.authorize(c,s);result={...result,workspaceMaterialProfile:'workspace-material-intake-v1'};}catch{/* No material capability when its owner binding is unavailable. */}if(workspaceFurnishing)try{await workspaceFurnishing.authorize(c,s);result={...result,workspaceFurnishingProfile:'workspace-furnishing-intake-v1',...(workspaceFurnishing.supportsStool()?{workspaceFurnishingStoolProfile:'workspace-furnishing-stool-v1'}:{}),...(workspaceFurnishing.supportsRoomVisual()?{workspaceFurnishingRoomVisualProfile:'workspace-furnishing-room-visual-v1'}:{}),...(workspaceFurnishing.supportsArtworkFrame()?{workspaceArtworkFrameProfile:'workspace-artwork-frame-v1'}:{}),...(workspaceFurnishing.supportsArtworkFrameModels()?{workspaceArtworkFrameModelsProfile:'workspace-artwork-frame-models-v1'}:{}),...(workspaceFurnishing.supportsFramePreparation()?{workspaceArtworkFramePreparationProfile:'workspace-artwork-frame-preparation-v1'}:{}),...(workspaceFurnishing.supportsPortalFinish()?{workspacePortalFinishProfile:'workspace-portal-finish-v1'}:{})};}catch{/* No capability when its owner binding is unavailable. */}return result;}));
 app.post('/api/v1/auth/logout',call(true,async(client,s,_req,reply)=>{
  await client.query('UPDATE auth_sessions SET revoked=true WHERE id=$1',[s.id]);
  reply.header('set-cookie',cookie('',true)); return {loggedOut:true};
 }));
 const prefix='/api/v1/tenants/:tenantId';
 if(workspaceFurnishing){
  if(!(workspaceFurnishing instanceof WorkspaceFurnishingIntakes)||!workspaceFurnishing.hasWriterLease()||input.mode!=='local'||freshOexTest||!(store instanceof FileBlobStore)||![nativeOexWorkspace,nativeExportWorkspace].some(context=>context&&workspaceFurnishing.matchesBinding(context,store)))throw Error('WORKSPACE_FURNISHING_CONFIGURATION');
  const ownedCall=(mutate:boolean,work:(client:PoolClient,s:Session,req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>call(mutate,async(c,s,req,reply)=>{const result=await work(c,s,req,reply);await workspaceFurnishing.authorize(c,s);return result;});
  const root=`${prefix}/workspace/furnishing-intakes`,library=`${prefix}/workspace/furnishings`,params=(req:FastifyRequest)=>req.params as {id:string;version:string};
  const cursor=(req:FastifyRequest)=>{const q=req.query as Record<string,unknown>;if(Object.keys(q).some(k=>k!=='cursor')||q.cursor!==undefined&&typeof q.cursor!=='string')throw new ApiError(400,'INVALID_CURSOR');return q.cursor as string|undefined;};
  const version=(req:FastifyRequest)=>{const value=params(req).version;if(value!=='1')throw new ApiError(400,'INVALID_INPUT');return 1;};
  app.post(root,{bodyLimit:65536},ownedCall(true,async(c,s,req,reply)=>{reply.code(201);return workspaceFurnishing.create(c,s,req.body);}));
  app.get(root,ownedCall(false,async(c,s,req)=>workspaceFurnishing.listIntakes(c,s,cursor(req))));
  app.get(`${root}/:id`,ownedCall(false,async(c,s,req)=>workspaceFurnishing.read(c,s,params(req).id)));
  app.put(`${root}/:id/model`,{bodyLimit:32*1024*1024},ownedCall(true,async(c,s,req)=>{if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');return workspaceFurnishing.upload(c,s,params(req).id,req.body);}));
  for(const action of ['complete','cancel','retry'] as const)app.post(`${root}/:id/${action}`,{schema:{body:object({})}},ownedCall(true,async(c,s,req)=>workspaceFurnishing[action](c,s,params(req).id)));
  app.get(library,ownedCall(false,async(c,s,req)=>workspaceFurnishing.list(c,s,cursor(req))));
  app.get(`${library}/:id/versions/:version`,ownedCall(false,async(c,s,req)=>workspaceFurnishing.readVersion(c,s,params(req).id,version(req))));
  app.get(`${library}/:id/versions/:version/display-check`,ownedCall(false,async(c,s,req,reply)=>{const result=await workspaceFurnishing.checkDisplay(c,s,params(req).id,version(req));reply.header('cache-control','no-store');return result;}));
  const previewRead=ownedCall(false,async(c,s,req)=>workspaceFurnishing.model(c,s,params(req).id,version(req),'display'));
  app.get(`${library}/:id/versions/:version/model`,async(req,reply)=>{const result=await previewRead(req,reply) as {bytes:Buffer;mime:string;sha256:string};return reply.header('content-type',result.mime).header('content-length',String(result.bytes.length)).header('x-content-type-options','nosniff').header('content-disposition','inline').header('x-exhibitos-sha256',result.sha256).send(result.bytes);});
  let closing=false,timer:ReturnType<typeof setTimeout>|undefined,running:Promise<void>|undefined;const tick=async()=>{try{if(!runtimeAvailable||runtimeAvailable())await workspaceFurnishing.work(pool);}catch{app.log.error('Workspace furnishing worker failed; retained token requires recovery');}finally{if(!closing){timer=setTimeout(()=>{running=tick();},1000);timer.unref();}}};
  app.addHook('onReady',async()=>{await pool.query('SELECT 1 FROM workspace_furnishing_intakes LIMIT 0');running=tick();});app.addHook('onClose',async()=>{closing=true;if(timer)clearTimeout(timer);await running;});
 }
 if(workspaceMaterial){
  if(input.mode!=='local'||freshOexTest||!(store instanceof FileBlobStore)||![nativeOexWorkspace,nativeExportWorkspace].some(context=>context&&workspaceMaterial.matchesBinding(context,store)))throw Error('WORKSPACE_MATERIAL_CONFIGURATION');
  const root=`${prefix}/workspace/material-intakes`,library=`${prefix}/workspace/materials`;
  const params=(req:FastifyRequest)=>req.params as {id:string;role:string;version:string};
  app.post(root,{bodyLimit:65536},call(true,async(c,s,req,reply)=>{reply.code(201);return workspaceMaterial.create(c,s,req.body);}));
  app.get(`${root}/:id`,call(false,async(c,s,req)=>workspaceMaterial.read(c,s,params(req).id)));
  app.put(`${root}/:id/maps/:role`,{bodyLimit:8*1024*1024},call(true,async(c,s,req)=>{if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');return workspaceMaterial.upload(c,s,params(req).id,params(req).role,req.body);}));
  for(const action of ['complete','cancel','retry'] as const)app.post(`${root}/:id/${action}`,{schema:{body:object({})}},call(true,async(c,s,req)=>workspaceMaterial[action](c,s,params(req).id)));
  app.get(library,call(false,async(c,s,req)=>{const q=req.query as Record<string,unknown>;if(Object.keys(q).some(k=>k!=='cursor')||q.cursor!==undefined&&typeof q.cursor!=='string')throw new ApiError(400,'INVALID_CURSOR');return workspaceMaterial.list(c,s,q.cursor as string|undefined);}));
  const version=(req:FastifyRequest)=>{const value=params(req).version;if(!/^[1-9][0-9]{0,9}$/.test(value))throw new ApiError(400,'INVALID_INPUT');return Number(value);};
  app.get(`${library}/:id/versions/:version`,call(false,async(c,s,req)=>workspaceMaterial.readVersion(c,s,params(req).id,version(req))));
  const previewRead=call(false,async(c,s,req)=>workspaceMaterial.preview(c,s,params(req).id,version(req),params(req).role));
  app.get(`${library}/:id/versions/:version/maps/:role`,async(req,reply)=>{const result=await previewRead(req,reply) as {bytes:Buffer;mime:string;sha256:string};return reply.header('content-type',result.mime).header('content-length',String(result.bytes.length)).header('x-content-type-options','nosniff').header('content-disposition','inline').header('x-exhibitos-sha256',result.sha256).send(result.bytes);});
  let closing=false,timer:ReturnType<typeof setTimeout>|undefined,running:Promise<void>|undefined;
  const tick=async()=>{try{if(!runtimeAvailable||runtimeAvailable())await workspaceMaterial.work(pool);}catch{app.log.error('Workspace material worker failed; retained token requires recovery');}finally{if(!closing){timer=setTimeout(()=>{running=tick();},1000);timer.unref();}}};
  app.addHook('onReady',async()=>{await pool.query('SELECT 1 FROM workspace_material_intakes LIMIT 0');running=tick();});
  app.addHook('onClose',async()=>{closing=true;if(timer)clearTimeout(timer);await running;});
 }

 const furnishingRole=(s:Session)=>{if(!['admin','artist','curator'].includes(s.role))throw new ApiError(403,'FORBIDDEN');};
 app.get(`${prefix}/studio/materials`,call(false,async(_c,s)=>{furnishingRole(s);return surfaceMaterialCatalog(input.mode==='local'?s.tenantId:undefined);}));
 app.get(`${prefix}/studio/materials/private-floor`,call(false,async(_c,s)=>{
  furnishingRole(s);
  if(input.mode!=='local')throw new ApiError(404,'MATERIAL_CATALOG_UNAVAILABLE');
  return privateFloorMaterialCatalog(s.tenantId);
 }));
 app.get(`${prefix}/studio/materials/:id/:version/preview`,call(false,async(_c,s,req,reply)=>{
  furnishingRole(s);
  if(input.mode!=='local')throw new ApiError(404,'MATERIAL_PREVIEW_UNAVAILABLE');
  const {id,version}=req.params as {id:string;version:string};
  const bytes=await readPrivateMaterialPreview(id,version);
  return reply.type('image/png').send(bytes);
 }));
 app.get(`${prefix}/studio/furnishings`,call(false,async(_c,s)=>{furnishingRole(s);return furnishingCatalog();}));
 app.get(`${prefix}/studio/furnishings/:catalogId/:catalogVersion/:role`,call(false,async(_c,s,req,reply)=>{
  furnishingRole(s);const p=req.params as {catalogId:string;catalogVersion:string;role:string};
  if(p.catalogVersion!=='1'||!['model','notice'].includes(p.role))throw new ApiError(404,'FURNISHING_UNAVAILABLE');
  let asset;try{asset=furnishingAsset('10000000-0000-4000-8000-000000000001',p.catalogId as FurnishingCatalogId);}catch{throw new ApiError(404,'FURNISHING_UNAVAILABLE');}
  const bytes=await readFurnishingBytes(asset,p.role as 'model'|'notice');return reply.header('content-type',p.role==='model'?'model/gltf-binary':'text/plain; charset=utf-8').send(bytes);
 }));

 const operationalMetrics=new OperationalMetrics(store);
 app.get(`${prefix}/operations/metrics`,call(false,async(c,s,_req,reply)=>{reply.header('cache-control','no-store');return operationalMetrics.observe(c,s);}));

 const privacy=new Privacy(pool,store),privacyPrefix=`${prefix}/privacy`;
 app.get(`${privacyPrefix}/policy`,call(false,async(c,s)=>privacy.policy(c,s)));
 app.put(`${privacyPrefix}/policy`,call(true,async(c,s,req)=>privacy.policy(c,s,req.body)));
 app.get(`${privacyPrefix}/consent`,call(false,async(c,s)=>privacy.consent(c,s)));
 app.put(`${privacyPrefix}/consent`,call(true,async(c,s,req)=>privacy.consent(c,s,req.body)));
 app.get(`${privacyPrefix}/export`,call(false,async(c,s)=>privacy.exportAccount(c,s)));
 app.post(`${privacyPrefix}/objects`,call(true,async(c,s,req)=>privacy.registerObject(c,s,req.body)));
 const privacyId=(req:FastifyRequest)=>{const value=(req.params as {id:string}).id;uuid(value);return value;};
 app.post(`${privacyPrefix}/objects/:id/archive`,{schema:{body:object({})}},call(true,async(c,s,req)=>privacy.archiveObject(c,s,privacyId(req))));
 app.post(`${privacyPrefix}/deletions`,call(true,async(c,s,req)=>privacy.requestDelete(c,s,req.body)));
 app.get(`${privacyPrefix}/deletions/:id`,call(false,async(c,s,req)=>privacy.status(c,s,privacyId(req))));
 app.post(`${privacyPrefix}/holds`,call(true,async(c,s,req)=>privacy.hold(c,s,req.body)));
 app.post(`${privacyPrefix}/holds/:id/release`,{schema:{body:object({})}},call(true,async(c,s,req)=>privacy.releaseHold(c,s,privacyId(req))));
 app.get(`${privacyPrefix}/publications/:id/summary`,call(false,async(c,s,req)=>privacy.summary(c,s,privacyId(req))));
 const analyticsRates=new Map<string,{count:number;until:number}>();
 app.post('/api/v1/publications/:id/analytics',async(req,reply)=>{
  guarded(req,true);reply.header('cache-control','no-store');const now=Date.now();for(const[k,v]of analyticsRates)if(v.until<=now)analyticsRates.delete(k);const rate=analyticsRates.get(req.ip);if(rate&&rate.count>=60||!rate&&analyticsRates.size>=4096)throw new ApiError(429,'RATE_LIMITED');analyticsRates.set(req.ip,{count:(rate?.count??0)+1,until:rate?.until??now+60000});
  const id=privacyId(req),sessionToken=token(req);if(sessionToken!==undefined||req.headers.cookie?.includes(settings.cookieName+'='))return auth.request(sessionToken,undefined,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined,true,(c,s)=>privacy.record(c,id,req.body,s));
  return transaction(pool,c=>privacy.record(c,id,req.body));
 });
 const institution=new Institution(pool),ip=`${prefix}/institution`;
 const institutionCall=(work:(c:PoolClient,p:InstitutionPrincipal,req:FastifyRequest)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
  guarded(req,req.method!=='GET');reply.header('cache-control','no-store');
  const tenant=(req.params as {tenantId:string}).tenantId;uuid(tenant);
  if(req.headers.authorization!==undefined){
   const header=req.headers.authorization;if(!/^Bearer eit_[A-Za-z0-9_-]{43}$/.test(header))throw new ApiError(401,'AUTH_REQUIRED');
   return institution.request(header.slice(7),tenant,(c,p)=>work(c,p,req));
  }
  // Even a GET can persist a bounded page cursor. Retain maintenance/CSRF fences.
  return auth.request(token(req),tenant,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined,true,(c,p)=>work(c,p,req));
 };
 const collectionId=(req:FastifyRequest)=>(req.params as {collectionId:string}).collectionId;
 const pageInput=(req:FastifyRequest)=>{const q=req.query as Record<string,unknown>;if(Object.keys(q).some(k=>!['cursor','filter','limit'].includes(k))||q.cursor!==undefined&&typeof q.cursor!=='string'||q.filter!==undefined&&typeof q.filter!=='string'||q.limit!==undefined&&(typeof q.limit!=='string'||!/^\d{1,3}$/.test(q.limit)))throw new ApiError(400,'INVALID_INPUT');return {...(q.cursor===undefined?{}:{cursor:q.cursor as string}),...(q.filter===undefined?{}:{filter:q.filter as string}),...(q.limit===undefined?{}:{limit:Number(q.limit)})};};
 app.post(`${ip}/collections`,call(true,async(c,s,req,reply)=>{reply.code(201);return institution.create(c,s,req.body);}));
 app.post(`${ip}/tokens`,call(true,async(c,s,req,reply)=>{reply.code(201);return institution.issue(c,s,req.body);}));
 app.post(`${ip}/tokens/:id/revoke`,call(true,async(c,s,req)=>institution.revoke(c,s,(req.params as {id:string}).id)));
 app.post(`${ip}/collections/:collectionId/import`,{bodyLimit:262144},institutionCall((c,p,r)=>institution.bulk(c,p,collectionId(r),r.body)));
 app.get(`${ip}/collections/:collectionId/batches/:batchId`,institutionCall((c,p,r)=>institution.batch(c,p,collectionId(r),(r.params as {batchId:string}).batchId)));
 app.post(`${ip}/collections/:collectionId/batches/:batchId/rollback`,{schema:{body:object({})}},institutionCall((c,p,r)=>institution.rollback(c,p,collectionId(r),(r.params as {batchId:string}).batchId)));
 app.get(`${ip}/collections/:collectionId/inventory`,institutionCall((c,p,r)=>institution.page(c,p,collectionId(r),pageInput(r))));
 app.get(`${ip}/collections/:collectionId/export`,institutionCall((c,p,r)=>institution.exportPage(c,p,collectionId(r),pageInput(r))));
 app.get(`${ip}/collections/:collectionId/inventory/:inventoryId/history`,institutionCall((c,p,r)=>institution.history(c,p,collectionId(r),(r.params as {inventoryId:string}).inventoryId)));

 app.post(`${prefix}/artworks/:id/processing-authorization`,{bodyLimit:4096,schema:{body:object({datasetDigest:{...str,pattern:'^[a-f0-9]{64}$'},requestId:id,processingConsent:{type:'boolean',const:true}})}},call(true,async(c,s,req)=>authorizeProcessingInput(c,s,(req.params as {id:string}).id,req.body as {datasetDigest:string;requestId:string;processingConsent:true},settings.origin)));
 if(store){const integrity=new Integrities(store,{migrationDirectory:fileURLToPath(new URL('../../../database/migrations/',import.meta.url))});app.get(`${prefix}/integrity`,call(false,async(c,s)=>integrity.inspect(c,s)));}

 const sp=`${prefix}/studio/exhibitions`;
 app.get(sp,{schema:{querystring:object({limit:{...str,pattern:'^[0-9]{1,2}$'},cursor:id,q:{...str,maxLength:100}},[])}},call(false,async(c,s,req)=>studio.list(c,s,req.query as Record<string,string>)));
 const studioBody=object({draft:{type:'object'},requestId:id});
 app.post(sp,{bodyLimit:1048576,schema:{body:studioBody}},call(true,async(c,s,req,reply)=>{const result=await studio.create(c,s,req.body as StudioInput);reply.code(201).header('etag',result.etag);return result;}));
 app.get(`${sp}/:id`,call(false,async(c,s,req,reply)=>{const p=req.params as {id:string};const result=await studio.get(c,s,p.id);reply.header('etag',result.etag);return result;}));
 if(nativeOexWorkspace)app.get(`${sp}/:id/native-viewport-policy`,call(false,async(c,s,req)=>studio.nativeViewportPolicy(c,s,(req.params as {id:string}).id)));
 if(nativeOexWorkspace)app.post(`${sp}/:id/native-viewport-check`,{bodyLimit:1048576,schema:{body:studioBody}},call(true,async(c,s,req)=>studio.validateNativeViewport(c,s,(req.params as {id:string}).id,req.body as StudioInput,req.headers['if-match']===undefined?undefined:requiredMatch(req.headers['if-match']))));
 if(freshOexTest){app.put(`${sp}/:id`,{bodyLimit:1048576,schema:{body:studioBody}},async(req,reply)=>{const p=req.params as {id:string};const result=await runSelectedStudioPut(saveSlot!,req,reply,(c,s)=>selectedStudio.put(c,s,p.id,req.body as StudioInput,requiredMatch(req.headers['if-match'])));reply.header('etag',result.etag);return result;});}
 else app.put(`${sp}/:id`,{bodyLimit:1048576,schema:{body:studioBody}},call(true,async(c,s,req,reply)=>{const p=req.params as {id:string};const result=await studio.put(c,s,p.id,req.body as StudioInput,requiredMatch(req.headers['if-match']));reply.header('etag',result.etag);return result;}));

 const freezes=store&&freezeConfig?new Freezes(pool,store,freezeConfig):null;
 const requireFreeze=()=>{if(!freezes)throw new ApiError(503,'FREEZE_UNAVAILABLE');return freezes;};
 app.get('/api/v1/freeze/authority',call(false,async(_c,s)=>({authority:requireFreeze().authority,tenantId:s.tenantId,subjectId:s.userId,expiresAt:s.expiresAt})));
 const fp=`${sp}/:id/freezes`, freezeId=(req:FastifyRequest)=>(req.params as {freezeId:string}).freezeId;
 // A nested route must match the actual owning exhibition, not merely possess an ID.
 const target=async(c:PoolClient,s:Session,req:FastifyRequest)=>{const f=requireFreeze(),info=await f.get(c,s,freezeId(req));if(info.manifest.source.exhibitionId!==(req.params as {id:string}).id)throw new ApiError(403,'FORBIDDEN');return f;};
 app.post(fp,{schema:{body:object({requestId:id})}},call(true,async(c,s,req,reply)=>{reply.code(201);return requireFreeze().create(c,s,(req.params as {id:string}).id,(req.body as {requestId:string}).requestId,requiredMatch(req.headers['if-match']));}));
 app.get(fp,call(false,async(c,s,req)=>requireFreeze().list(c,s,(req.params as {id:string}).id)));
 app.get(`${fp}/:freezeId`,call(false,async(c,s,req)=>{await target(c,s,req);return requireFreeze().get(c,s,freezeId(req));}));
 app.get(`${fp}/:freezeId/check`,call(false,async(c,s,req)=>(await target(c,s,req)).check(c,s,freezeId(req))));
 const grantBody={schema:{body:object({seconds:{type:'integer',minimum:1,maximum:28800}})}};
 app.post(`${fp}/:freezeId/offline`,grantBody,call(true,async(c,s,req,reply)=>{const f=await target(c,s,req);return reply.header('content-disposition','attachment; filename="exhibition.oef"').send(await f.offline(c,s,freezeId(req),(req.body as {seconds:number}).seconds));}));
 app.post(`${fp}/:freezeId/authorize`,grantBody,call(true,async(c,s,req)=>(await target(c,s,req)).authorize(c,s,freezeId(req),(req.body as {seconds:number}).seconds)));
 for(const action of ['revoke','restore'] as const)app.post(`${fp}/:freezeId/${action}`,{schema:{body:object({})}},call(true,async(c,s,req)=>(await target(c,s,req)).availability(c,s,freezeId(req),action==='restore')));
 if(freezes&&!freshOexTest){if(deferredStartup)deferredStartup.push(async()=>{await freezes.recover();});app.addHook('onReady',async()=>{await pool.query('SELECT 1 FROM exhibition_freezes LIMIT 0');if(!deferredStartup)await freezes.recover();});}
 const oex=store?new Oex(pool,store,nativeOexWorkspace,workspaceMaterial,workspaceFurnishing):null;
 if(nativeExportWorkspace&&store instanceof FileBlobStore&&oex)registerNativeBoundedOexExport(app,{auth,config:input,context:nativeExportWorkspace,blobRoot:store.root,oex,guard:(req,mutate)=>guarded(req,mutate),token});
 if(nativeDetailContext&&store instanceof FileBlobStore)registerNativeDetailHttp(app,{auth,context:nativeDetailContext,guard:(req,mutate)=>guarded(req,mutate),token,...(nativeOexWorkspace?{original:{studio,cms:new Cms(store),imports:new Imports(pool,store,nativeOexWorkspace),blobs:store}}:{})});
 const requireOex=()=>{if(!oex)throw new ApiError(503,'STORAGE_UNAVAILABLE');return oex;};
 const op=`${prefix}/oex/imports`,jobId=(req:FastifyRequest)=>(req.params as {id:string}).id;
 app.post(`${sp}/:id/oex/export`,{schema:{body:object({})}},call(true,async(c,s,req,reply)=>{const bytes=await requireOex().export(c,s,jobId(req),requiredMatch(req.headers['if-match']));return reply.header('content-type','application/vnd.exhibitos.oex+zip').header('content-disposition','attachment; filename="exhibition.oex"').send(bytes);}));
 app.get(op,call(false,async(c,s)=>requireOex().list(c,s)));
 app.post(op,{schema:{body:object({requestId:id,bytes:{type:'integer',minimum:1,maximum:MAX_OEX_UPLOAD},sha256:{...str,pattern:'^[a-f0-9]{64}$'}})}},call(true,async(c,s,req,reply)=>{reply.code(201);return requireOex().create(c,s,req.body as OexInput);}));
 app.get(`${op}/:id`,call(false,async(c,s,req)=>requireOex().view(await requireOex().access(c,s,jobId(req)))));
 app.put(`${op}/:id/bytes`,{bodyLimit:MAX_OEX_UPLOAD},call(true,async(c,s,req)=>{if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');return requireOex().upload(c,s,jobId(req),req.body);}));
 app.post(`${op}/:id/complete`,{schema:{body:object({})}},call(true,async(c,s,req)=>requireOex().complete(c,s,jobId(req))));
 for(const action of ['retry','cancel'] as const)app.post(`${op}/:id/${action}`,{schema:{body:object({})}},call(true,async(c,s,req)=>requireOex().action(c,s,jobId(req),action)));
 if(oexWorker&&oex){
  let closing=false,timer:ReturnType<typeof setTimeout>|undefined,running:Promise<void>|undefined;
  const tick=async()=>{try{if(!runtimeAvailable||runtimeAvailable()){await oex.runNext();if(!runtimeAvailable||runtimeAvailable())await freezes?.recover();}}catch{app.log.error('OEX worker iteration failed; pending jobs remain recoverable');}finally{if(!closing){timer=setTimeout(()=>{running=tick();},1000);timer.unref();}}};
  app.addHook('onReady',async()=>{await pool.query('SELECT 1 FROM oex_import_jobs LIMIT 0');running=tick();});
  app.addHook('onClose',async()=>{closing=true;if(timer)clearTimeout(timer);await running;});
 }

 const audio=new Audio(store),ap=`${sp}/:id/audio`;
 const audioParams=(req:FastifyRequest)=>req.params as {id:string;audioId:string};
 app.get(ap,call(false,async(c,s,req)=>audio.list(c,s,audioParams(req).id)));
 app.post(ap,{schema:{body:object({requestId:id,mime:{const:'audio/wav'},bytes:{type:'integer',minimum:44,maximum:MAX_AUDIO},sha256:{...str,pattern:'^[a-f0-9]{64}$'},rights:{type:'object'}})}},call(true,async(c,s,req,reply)=>{reply.code(201);return audio.create(c,s,audioParams(req).id,req.body as AudioInput);}));
 app.get(`${ap}/:audioId`,call(false,async(c,s,req)=>{const p=audioParams(req);return audio.view(await audio.access(c,s,p.id,p.audioId));}));
 app.put(`${ap}/:audioId/bytes`,{bodyLimit:MAX_AUDIO},call(true,async(c,s,req)=>{const p=audioParams(req);if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');return audio.upload(c,s,p.id,p.audioId,req.body);}));
 app.post(`${ap}/:audioId/approve`,{schema:{body:object({revision:{const:1}})}},call(true,async(c,s,req)=>{const p=audioParams(req);return audio.approve(c,s,p.id,p.audioId,(req.body as {revision:number}).revision);}));
 for(const action of ['revoke','restore'] as const)app.post(`${ap}/:audioId/${action}`,{schema:{body:object({})}},call(true,async(c,s,req)=>{const p=audioParams(req);return audio.availability(c,s,p.id,p.audioId,action==='restore');}));
 const covers=new CoverImages(store),coverPath=`${sp}/:id/cover-images`,coverParams=(req:FastifyRequest)=>req.params as {id:string;imageId:string};
 app.get(coverPath,call(false,async(c,s,req)=>covers.list(c,s,coverParams(req).id)));
 app.post(coverPath,{schema:{body:object({requestId:id,mime:{const:'image/png'},bytes:{type:'integer',minimum:33,maximum:MAX_SPACE_STILL_BYTES},sha256:{...str,pattern:'^[a-f0-9]{64}$'},rights:{type:'object'}})}},call(true,async(c,s,req,reply)=>{reply.code(201);return covers.create(c,s,coverParams(req).id,req.body as CoverImageInput);}));
 app.get(`${coverPath}/:imageId`,call(false,async(c,s,req)=>{const p=coverParams(req);return covers.view(await covers.access(c,s,p.id,p.imageId));}));
 app.put(`${coverPath}/:imageId/bytes`,{bodyLimit:MAX_SPACE_STILL_BYTES},call(true,async(c,s,req)=>{const p=coverParams(req);if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');return covers.upload(c,s,p.id,p.imageId,req.body);}));
 app.post(`${coverPath}/:imageId/approve`,{schema:{body:object({revision:{const:1}})}},call(true,async(c,s,req)=>{const p=coverParams(req);return covers.approve(c,s,p.id,p.imageId,(req.body as {revision:number}).revision);}));
 app.get(`${coverPath}/:imageId/preview`,{schema:{querystring:object({expectedSha256:{...str,pattern:'^[a-f0-9]{64}$'}})}},call(false,async(c,s,req,reply)=>{const p=coverParams(req),result=await covers.preview(c,s,p.id,p.imageId,(req.query as {expectedSha256:string}).expectedSha256);reply.header('content-type','image/png').header('x-content-type-options','nosniff').header('content-disposition','inline').header('x-exhibitos-display-copy','true').header('x-exhibitos-watermark-mode','none').header('x-exhibitos-watermarked','false').header('x-exhibitos-cover-sha256',result.sourceSha256);return result.bytes;}));
 for(const action of ['revoke','restore'] as const)app.post(`${coverPath}/:imageId/${action}`,{schema:{body:object({})}},call(true,async(c,s,req)=>{const p=coverParams(req);return covers.availability(c,s,p.id,p.imageId,action==='restore');}));
 const furnishingOwner=nativeOexWorkspace?.workspaceFurnishingPublication&&workspaceFurnishing?.matchesBinding(nativeOexWorkspace,store)?nativeOexWorkspace:undefined;
 const publications=new Publications(pool,store,nativeOexWorkspace,workspaceFurnishing,furnishingOwner,workspaceMaterial);
 app.get(`${prefix}/studio/publications`,call(false,async(c,s)=>publications.catalog(c,s)));
 app.get(`${prefix}/studio/publications/:id/editing-draft`,call(false,async(c,s,req,reply)=>{const result=await publications.editingDraft(c,s,(req.params as {id:string}).id);reply.header('etag',result.etag);return result;}));
 const readPublic=async(id:string,assetId?:string,profile?:string)=>{
  const value=await (publicationSource ? (assetId ? publicationSource.asset(id,assetId) : publicationSource.anonymous(id)) : publications.anonymous(id,assetId));
  if(!assetId){const projection=value as {exhibition?:{extensions?:Record<string,unknown>}};if(projection?.exhibition?.extensions&&Object.hasOwn(projection.exhibition.extensions,'org.exhibitos.viewer/footstep-resources')&&profile!=='footstep-resources-v1')throw new ApiError(406,'PUBLICATION_PROFILE_UNSUPPORTED');}
  return value;
 };
 if(!freshOexTest){
 const authorizeHost=openingHostAuthority(pool);
 const opening=registerOpening(app,{origin:settings.origin,clientOrigin:settings.clientOrigin,publication:async id=>await readPublic(id,undefined,'footstep-resources-v1') as import('./realtime.ts').RealtimePublication,authorizeHost});
 registerRealtime(app,{origin:settings.origin,clientOrigin:settings.clientOrigin,publication:async id=>await readPublic(id,undefined,'footstep-resources-v1') as import('./realtime.ts').RealtimePublication,openingUpgrade:opening.upgrade,...(runtimeAvailable?{isAvailable:runtimeAvailable}:{})});
 app.post(`${prefix}/studio/publications/:id/opening-host`,{schema:{body:object({revisionSha256:{type:'string',pattern:'^[a-f0-9]{64}$'}})}},async(req,reply)=>{
  guarded(req,true);reply.header('cache-control','no-store');
  const params=req.params as {id:string;tenantId:string};uuid(params.id);uuid(params.tenantId);
  // Finish the authenticated mutation gate before anonymous publication takes its
  // own shared policy locks. Keeping the exclusive auth lock would self-deadlock.
  const subject=await auth.request(token(req),params.tenantId,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined,true,async(_c,s)=>{
   const subject={userId:s.userId,tenantId:s.tenantId,sessionId:s.id};
   if(!await authorizeHost(subject,params.id))throw new ApiError(403,'FORBIDDEN');
   return subject;
  });
  const current=await readPublic(params.id,undefined,'footstep-resources-v1') as import('./realtime.ts').RealtimePublication;
  if(current.publication.revisionSha256!==(req.body as {revisionSha256:string}).revisionSha256)throw new ApiError(409,'REVISION_CONFLICT');
  // issueHost and socket admission each recheck live session/owner authority.
  return opening.issueHost(params.id,subject);
 });
 }
 const activePublications=new Set<Promise<unknown>>(),detailPublications=new Set<AbortController>();let closingPublications=false;
 app.addHook('preClose',async()=>{closingPublications=true;for(const controller of detailPublications)controller.abort();});
 app.addHook('onClose',async()=>{await Promise.allSettled([...activePublications]);});
 const localPublication=(kind:'readiness'|'publish')=>async(req:FastifyRequest,reply:FastifyReply)=>{
  const mutate=kind==='publish';guarded(req,mutate);reply.header('cache-control','no-store');
  const p=req.params as {tenantId:string;id:string};uuid(p.tenantId);uuid(p.id);
  const requestId=mutate?(req.body as {requestId:string}).requestId:undefined;if(requestId)uuid(requestId);
  const profile=req.headers['x-exhibitos-publication-profile'];if(profile!==undefined&&profile!=='bounded-local-v1'&&profile!=='native-original-v1')throw new ApiError(400,'INVALID_INPUT');
  const detailMode=profile==='native-original-v1';if(detailMode&&(!mutate||!nativeDetailContext||!nativeOexWorkspace||!(store instanceof FileBlobStore)))throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');
  const match=mutate||profile!==undefined?requiredMatch(req.headers['if-match']):undefined;
  if(profile===undefined)return call(mutate,async(c,s,_request,response)=>{if(!mutate)return publications.ready(c,s,p.id);const result=await publications.publish(c,s,p.id,requestId!,match!);response.code(201);return result;})(req,reply);
  if(closingPublications)throw new ApiError(409,'PUBLICATION_STAGE_UNAVAILABLE');
  let operation:NativeLocalPublicationStage|undefined,committed=false;const cancelled=new AbortController();
  const abort=()=>cancelled.abort(),closed=()=>{if(!reply.raw.writableFinished)abort();};
  if(detailMode){detailPublications.add(cancelled);req.raw.once('aborted',abort);reply.raw.once('close',closed);if(req.raw.aborted||reply.raw.destroyed)abort();}
  const work=(async()=>{try{
   const run=async(c:PoolClient,s:Session)=>{
    if(!nativeExportWorkspace||!(store instanceof FileBlobStore)||s.tenantId!==nativeExportWorkspace.tenantId||s.userId!==nativeExportWorkspace.principalId)throw new ApiError(403,'FORBIDDEN');
    // Readiness can populate derivative caches. Follow the existing auth →
    // maintenance lock order so backups cannot snapshot midway through it.
    if(!mutate)await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
    if(detailMode){cancelled.signal.throwIfAborted();if(!nativeDetailContext!.live())throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');}
    await nativeExportWorkspace.assertDatabase(c);
    if(detailMode)cancelled.signal.throwIfAborted();
    if(detailMode&&!hasQualifiedOriginalImageModel(nativeDetailContext,s,p.id))throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');
    if(mutate){const existing=await publications.existingRequest(c,s,p.id,requestId!,match!,detailMode);if(existing){if(detailMode){cancelled.signal.throwIfAborted();if(!nativeDetailContext!.live())throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');}if(!Number.isFinite(Date.parse(s.expiresAt))||Date.now()>=Date.parse(s.expiresAt))throw new ApiError(401,'AUTH_REQUIRED');return existing;}}
    {
     const row=await studio.access(c,s,p.id),current=etag(row.revision,row.metadata);if(match&&match!==current)throw new ApiError(412,'REMOTE_CONFLICT');
     operation=await NativeLocalPublicationStage.create(c,s,nativeExportWorkspace,store,kind,p.id,current,requestId,detailMode);
    }
    const producer=detailMode?createNativeOriginalPublication({context:nativeDetailContext!,studio,cms,imports:importer(),blobs:store,operationSignal:cancelled.signal}):undefined;
    if(detailMode)cancelled.signal.throwIfAborted();
    const result=await (mutate?publications.publish(c,s,p.id,requestId!,match!,operation,producer):publications.ready(c,s,p.id,operation));
    if(!Number.isFinite(Date.parse(s.expiresAt))||Date.now()>=Date.parse(s.expiresAt))throw new ApiError(401,'AUTH_REQUIRED');
    if(detailMode)cancelled.signal.throwIfAborted();return result;
   };
   const credentials=[token(req),p.tenantId,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined] as const;
   const result=detailMode?await auth.requestForNativeWorkspaceMutation(...credentials,run):await auth.request(...credentials,mutate,run);
   committed=true;await operation?.finish(true);if(mutate)reply.code(201);return result;
  }catch(error){if(!committed)await operation?.finish(false);throw error;}})();
  activePublications.add(work);try{return await work;}finally{activePublications.delete(work);if(detailMode){detailPublications.delete(cancelled);req.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed);}}
 };
 app.get(`${sp}/:id/ready`,localPublication('readiness'));
 app.get(`${sp}/:id/publications`,call(false,async(c,s,req)=>publications.listForRead(c,s,(req.params as {id:string}).id)));
 app.post(`${sp}/:id/publications`,{schema:{body:object({requestId:id})}},localPublication('publish'));
 for(const action of ['unpublish','republish'] as const)app.post(`${prefix}/studio/publications/:id/${action}`,{schema:{body:object({})}},call(true,async(c,s,req)=>publications[action](c,s,(req.params as {id:string}).id)));
 if(federationConfig){
  const federation=new Federation(pool,federationConfig),rates=new Map<string,{count:number;until:number}>();
  const rate=(req:FastifyRequest)=>{const now=Date.now();for(const [key,value] of rates)if(value.until<=now)rates.delete(key);const prior=rates.get(req.ip);if(prior&&prior.count>=60||!prior&&rates.size>=4096)throw new ApiError(429,'RATE_LIMITED');rates.set(req.ip,{count:(prior?.count??0)+1,until:prior?.until??now+60000});};
  const admin=(s:Session)=>{if(s.role!=='admin')throw new ApiError(403,'FORBIDDEN');};
  app.get('/api/v1/federation/discovery',async(req,reply)=>{rate(req);reply.header('cache-control','no-store');return transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');return federation.discovery(c,async(c,ids)=>(await publications.discoveryMetadata(c,ids)).map(item=>({...item,url:new URL(`/p/${item.publicationId}`,federationConfig.origin).href})));});});
  app.get('/api/v1/federation/directory',async(req,reply)=>{rate(req);reply.header('cache-control','no-store');return transaction(pool,c=>federation.directory(c));});
  app.post(`${prefix}/federation/listings/:id`,{schema:{body:object({enabled:{type:'boolean'}})}},call(true,async(c,s,req)=>{admin(s);const id=(req.params as {id:string}).id;await publications.list(c,s,(await c.query('SELECT exhibition_id FROM studio_publications WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0]?.exhibition_id??id);return federation.listing(c,id,(req.body as {enabled:boolean}).enabled);}));
  app.post(`${prefix}/federation/peers`,{schema:{body:object({origin:str,publicKey:str,state:{enum:['trusted','blocked']}})}},call(true,async(c,s,req)=>{admin(s);const b=req.body as {origin:string;publicKey:string;state:'trusted'|'blocked'};return federation.peer(c,b.origin,b.publicKey,b.state);}));
  app.post(`${prefix}/federation/sync`,{schema:{body:object({origin:str})}},call(true,async(_c,s,req)=>{admin(s);return federation.sync((req.body as {origin:string}).origin);}));
 }
 app.get('/api/v1/publications/:id',async(req,reply)=>{reply.header('cache-control','no-store').header('pragma','no-cache');return readPublic((req.params as {id:string}).id,undefined,(req.query as {footsteps?:string}).footsteps==='1'?'footstep-resources-v1':undefined);});
 app.get('/api/v1/publications/:id/xr-export/:assetId',async(req,reply)=>{reply.header('cache-control','no-store');const p=req.params as {id:string;assetId:string};return publications.xrExport(p.id,p.assetId);});
 app.get('/api/v1/publications/:id/assets/:assetId',async(req,reply)=>{reply.header('cache-control','no-store').header('pragma','no-cache');const p=req.params as {id:string;assetId:string};const result=await readPublic(p.id,p.assetId) as {bytes:Buffer;mime:string;revisionSha256:string};reply.header('content-type',result.mime).header('x-content-type-options','nosniff').header('content-disposition','inline').header('x-exhibitos-publication-revision',result.revisionSha256);return result.bytes;});
 app.get('/api/v1/publications/:id/furnishing-notices/:assetId',async(req,reply)=>{reply.header('cache-control','no-store').header('pragma','no-cache');const p=req.params as {id:string;assetId:string};const result=publicationSource?await publicationSource.furnishingNotice?.(p.id,p.assetId):await publications.furnishingNotice(p.id,p.assetId);if(!result)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');reply.header('content-type',result.mime).header('x-content-type-options','nosniff').header('content-disposition','inline').header('x-exhibitos-publication-revision',result.revisionSha256);return result.bytes;});
 let activeMaterialBatches=0;
 const materialBatches=new Map<string,{id:string;revision:string;records:Awaited<ReturnType<Publications['materialMapBatch']>>['records'];expires:number;remaining:number;inFlight:boolean;finished:boolean;cancel:()=>void;fenceCancel?:()=>void;expiry?:ReturnType<typeof setTimeout>}>();let activeMaterialFences=0;
 const removeMaterialBatch=(token:string)=>{const value=materialBatches.get(token);if(!value)return;materialBatches.delete(token);if(value.expiry)clearTimeout(value.expiry);value.cancel();};
 app.get('/api/v1/publications/:id/material-maps',async(req,reply)=>{
  reply.header('cache-control','no-store').header('pragma','no-cache');if(publicationSource)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');if(activeMaterialBatches>=2)throw new ApiError(503,'PUBLICATION_UNAVAILABLE');activeMaterialBatches++;
  const id=(req.params as {id:string}).id,abort=new AbortController(),onClose=()=>abort.abort(),timer=setTimeout(()=>abort.abort(),60000);timer.unref();reply.raw.once('close',onClose);let handedOff=false,released=false,token:string|undefined;
  const release=()=>{if(released)return;released=true;clearTimeout(timer);reply.raw.removeListener('close',onClose);activeMaterialBatches--;};
  try{
   const result=await publications.materialMapBatch(id,abort.signal);abort.signal.throwIfAborted();if(reply.raw.destroyed)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
   for(const [key,value] of materialBatches)if(value.expires<=Date.now())removeMaterialBatch(key);if(materialBatches.size>=64){for(const [key,value] of materialBatches){if(value.finished&&!value.inFlight){removeMaterialBatch(key);break;}}}if(materialBatches.size>=64)throw new ApiError(503,'PUBLICATION_UNAVAILABLE');
   token=randomUUID();const selectedToken=token,state:{id:string;revision:string;records:typeof result.records;expires:number;remaining:number;inFlight:boolean;finished:boolean;cancel:()=>void;fenceCancel?:()=>void;expiry?:ReturnType<typeof setTimeout>}={id,revision:result.revisionSha256,records:result.records,expires:Date.now()+60000,remaining:new Set(result.records.map(record=>`${record.materialId}:${record.version}`)).size+1,inFlight:false,finished:false,cancel:()=>{abort.abort();state.fenceCancel?.();}};materialBatches.set(selectedToken,state);state.expiry=setTimeout(()=>removeMaterialBatch(selectedToken),60000);state.expiry.unref();
   const stream=new PassThrough({highWaterMark:65536}),stop=()=>stream.destroy();let completed=false,streamClosed=false,pumpDone=false;const drainRelease=()=>{if(streamClosed&&pumpDone){state.finished=completed;release();}};abort.signal.addEventListener('abort',stop,{once:true});stream.on('error',()=>{});stream.once('close',()=>{streamClosed=true;if(!completed)removeMaterialBatch(selectedToken);abort.signal.removeEventListener('abort',stop);drainRelease();});
   const drain=async()=>{if(stream.destroyed||abort.signal.aborted)throw Error('PUBLICATION_UNAVAILABLE');await once(stream,'drain',{signal:abort.signal});};
   const write=async(bytes:Buffer)=>{for(let offset=0;offset<bytes.length;offset+=65536){abort.signal.throwIfAborted();if(!stream.write(bytes.subarray(offset,offset+65536)))await drain();}};
   const pump=async()=>{await write(result.chunks[0]!);await write(result.chunks[1]!);let previous='';for(let i=0;i<result.records.length;i++){const record=result.records[i]!,bytes=result.chunks[i+2]!,key=`${record.materialId}:${record.version}`;let offset=0;if(key!==previous){let waiting:Promise<void>|undefined;await publications.materialMapPolicy(id,result.revisionSha256,result.records,abort.signal,()=>{if(!stream.write(bytes.subarray(0,Math.min(65536,bytes.length)))){waiting=drain();void waiting.catch(()=>{});}});offset=Math.min(65536,bytes.length);if(waiting)await waiting;previous=key;}if(offset<bytes.length)await write(bytes.subarray(offset));}completed=true;stream.end();};
   reply.header('content-type','application/vnd.exhibitos.material-maps-v1').header('content-length',result.chunks.reduce((sum,part)=>sum+part.length,0)).header('x-content-type-options','nosniff').header('x-exhibitos-publication-revision',result.revisionSha256).header('x-exhibitos-material-batch',selectedToken);handedOff=true;void pump().catch(()=>stream.destroy()).finally(()=>{pumpDone=true;drainRelease();});return reply.send(stream);
  }finally{if(!handedOff){if(token)removeMaterialBatch(token);release();}}
 });
 app.get('/api/v1/publications/:id/material-maps/:token/fence',async(req,reply)=>{
  reply.header('cache-control','no-store').header('pragma','no-cache');const {id,token}=req.params as {id:string;token:string},state=materialBatches.get(token);if(!state||state.id!==id||!state.revision||!state.records||state.expires<=Date.now()||state.remaining<1)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');if(state.inFlight||activeMaterialFences>=4)throw new ApiError(503,'PUBLICATION_UNAVAILABLE');state.inFlight=true;state.remaining--;activeMaterialFences++;
  const abort=new AbortController(),onClose=()=>abort.abort(),timer=setTimeout(()=>abort.abort(),15000);state.fenceCancel=onClose;timer.unref();reply.raw.once('close',onClose);
  try{const result=await publications.materialMapPolicy(id,state.revision,state.records,abort.signal);abort.signal.throwIfAborted();if(materialBatches.get(token)!==state||state.expires<=Date.now())throw new ApiError(404,'PUBLICATION_UNAVAILABLE');return {revisionSha256:result.revisionSha256};}finally{clearTimeout(timer);reply.raw.removeListener('close',onClose);state.fenceCancel=undefined;state.inFlight=false;activeMaterialFences--;}
 });
 app.delete('/api/v1/publications/:id/material-maps/:token',async(req,reply)=>{reply.header('cache-control','no-store').header('pragma','no-cache');const {id,token}=req.params as {id:string;token:string},state=materialBatches.get(token);if(!state||state.id!==id)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');removeMaterialBatch(token);return reply.code(204).send();});
 app.get('/api/v1/publications/:id/resources/:sha256',async(req,reply)=>{reply.header('cache-control','no-store').header('pragma','no-cache');const p=req.params as {id:string;sha256:string};const result=publicationSource?await publicationSource.resource?.(p.id,p.sha256):await publications.resource(p.id,p.sha256);if(!result)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');reply.header('content-type',result.mime).header('x-content-type-options','nosniff').header('content-disposition','inline').header('x-exhibitos-publication-revision',result.revisionSha256);return result.bytes;});
 const cms=new Cms(store),cp=`${prefix}/cms`;
 app.get(`${prefix}/studio/artworks/:id`,call(false,async(c,s,req)=>cms.studioArtwork(c,s,cmsId(req))));
 const artistBody={name:{...str,minLength:1,maxLength:512},bio:{...str,maxLength:16384}};
 const vector3={type:'array',items:{type:'number'},minItems:3,maxItems:3},vector4={type:'array',items:{type:'number'},minItems:4,maxItems:4};
 const displayReference=object({version:{const:1},status:{const:'provisional-uncalibrated'},assetSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},rawBounds:object({min:vector3,max:vector3}),referenceHeightMeters:{type:'number',exclusiveMinimum:0,maximum:10000},pose:object({position:vector3,rotation:vector4,scale:vector3})});
 const fields={displayReference,medium:{...str,minLength:1,maxLength:512},creationYear:{type:'integer',minimum:1,maximum:9999},title:{...str,minLength:1,maxLength:512},description:{...str,maxLength:16384},dimensions:object({width:{type:'number',exclusiveMinimum:0,maximum:1000000},height:{type:'number',exclusiveMinimum:0,maximum:1000000},depth:{type:'number',exclusiveMinimum:0,maximum:1000000},unit:{const:'m'}},['width','height','unit']),rights:{type:'object'},provenance:object({source:{enum:['human-authored','ai-assisted','ai-generated','synthetic']},sourceUnits:{enum:['m','cm','mm','unknown']},scaleApplied:{type:'boolean'},notes:{...str,maxLength:4096}})};
 const cmsId=(req:FastifyRequest)=>{const p=req.params as {id:string};uuid(p.id);return p.id;};
 const preservation=new Preservation(store);
 app.get(`${cp}/artworks/:id/preservation`,call(false,async(c,s,req)=>preservation.inventory(c,s,cmsId(req))));
 const assistance=new Assistance(cms),assistancePrefix=`${cp}/artworks/:id/assistance`;
 const assistanceId=(req:FastifyRequest)=>{const value=(req.params as {requestId?:string;proposalId?:string}).requestId??(req.params as {proposalId:string}).proposalId;uuid(value);return value;};
 app.get(assistancePrefix,call(false,async(c,s,req)=>assistance.list(c,s,cmsId(req))));
 app.post(assistancePrefix,call(true,async(c,s,req,reply)=>{reply.code(201);return assistance.request(c,s,cmsId(req),req.body);}));
 app.post(`${assistancePrefix}/requests/:requestId/proposals`,call(true,async(c,s,req,reply)=>{reply.code(201);return assistance.propose(c,s,cmsId(req),assistanceId(req),req.body);}));
 app.post(`${assistancePrefix}/proposals/:proposalId/review`,call(true,async(c,s,req)=>assistance.review(c,s,cmsId(req),assistanceId(req),req.body)));
 app.post(`${assistancePrefix}/proposals/:proposalId/apply`,{schema:{body:object({})}},call(true,async(c,s,req)=>assistance.apply(c,s,cmsId(req),assistanceId(req))));

 app.post(`${cp}/artists`,{schema:{body:object({...artistBody,userId:{anyOf:[id,{type:'null'}]}},['name','bio'])}},call(true,async(c,s,req,reply)=>{reply.code(201);return cms.createArtist(c,s,req.body as {name:string;bio:string;userId?:string|null});}));
 app.get(`${cp}/artists`,{schema:{querystring:object({limit:{...str,pattern:'^[0-9]{1,2}$'},cursor:id,q:{...str,maxLength:100},archived:{enum:['true','false']}},[])}},call(false,async(c,s,req)=>cms.list(c,s,'artists',req.query as Record<string,string>)));
 app.get(`${cp}/artists/:id`,call(false,async(c,s,req)=>cms.artistView(await cms.artist(c,s,cmsId(req),true))));
 app.patch(`${cp}/artists/:id`,{schema:{body:object({...artistBody,revision:{type:'integer',minimum:1}})}},call(true,async(c,s,req)=>cms.reviseArtist(c,s,cmsId(req),req.body as {name:string;bio:string;revision:number})));
 app.post(`${cp}/artworks`,{schema:{body:object({...fields,artistId:id},['title','description','dimensions','rights','provenance','artistId'])}},call(true,async(c,s,req,reply)=>{reply.code(201);return cms.createArtwork(c,s,req.body as ArtworkMetadata&{artistId:string});}));
 app.get(`${cp}/artworks`,{schema:{querystring:object({limit:{...str,pattern:'^[0-9]{1,2}$'},cursor:id,q:{...str,maxLength:100},archived:{enum:['true','false']}},[])}},call(false,async(c,s,req)=>cms.list(c,s,'artworks',req.query as Record<string,string>)));
 app.get(`${cp}/artworks/:id`,call(false,async(c,s,req)=>cms.detail(c,s,cmsId(req),true)));
 app.patch(`${cp}/artworks/:id`,{schema:{body:object({...fields,revision:{type:'integer',minimum:1}},['title','description','dimensions','rights','provenance','revision'])}},call(true,async(c,s,req)=>cms.revise(c,s,cmsId(req),req.body as ArtworkMetadata&{revision:number})));
 for(const kind of ['artists','artworks'] as const){
  app.get(`${cp}/${kind}/:id/revisions`,call(false,async(c,s,req)=>cms.revisions(c,s,cmsId(req),kind)));
  for(const action of ['archive','restore'] as const)app.post(`${cp}/${kind}/:id/${action}`,{schema:{body:object({revision:{type:'integer',minimum:1}})}},call(true,async(c,s,req)=>cms.archive(c,s,kind,cmsId(req),action==='restore',(req.body as {revision:number}).revision)));
 }
 app.post(`${cp}/artworks/:id/approve`,{schema:{body:object({revision:{type:'integer',minimum:1},assetId:id})}},call(true,async(c,s,req)=>cms.approve(c,s,cmsId(req),req.body as {revision:number;assetId:string})));
 app.get(`${cp}/artworks/:id/display`,call(false,async(c,s,req)=>cms.display(c,s,cmsId(req))));
 app.get(`${cp}/artworks/:id/preview`,{schema:{querystring:object({expectedRevision:{...str,pattern:'^[1-9][0-9]{0,9}$'}},[])}},call(false,async(c,s,req,reply)=>{const q=req.query as {expectedRevision?:string};const result=await cms.display(c,s,cmsId(req),true,q.expectedRevision===undefined?undefined:Number(q.expectedRevision)) as {bytes:Buffer;mime:string;revision:number;watermarked:boolean;watermarkMode:'none'|'embedded'};reply.header('content-type',result.mime).header('x-content-type-options','nosniff').header('content-disposition','inline').header('x-exhibitos-display-copy','true').header('x-exhibitos-watermark-mode',result.watermarkMode).header('x-exhibitos-watermarked',String(result.watermarked)).header('x-exhibitos-artwork-revision',String(result.revision));return result.bytes;}));
 const thumbnailReceipts=()=>{if(!store)throw new ApiError(503,'STORAGE_UNAVAILABLE');return new ArtworkThumbnailReceipts(store);};
 app.get(`${cp}/artworks/:id/thumbnail-selection`,{schema:{querystring:object({expectedRevision:{...str,pattern:'^[1-9][0-9]{0,9}$'}})}},call(false,async(c,s,req)=>thumbnailReceipts().current(c,s,cmsId(req),Number((req.query as {expectedRevision:string}).expectedRevision))));
 app.post(`${cp}/artworks/:id/thumbnail-selection`,call(true,async(c,s,req)=>thumbnailReceipts().select(c,s,cmsId(req),req.body)));
 const imports=store?new Imports(pool,store,nativeOexWorkspace):undefined;
 const importer=()=>{if(!imports)throw new ApiError(503,'STORAGE_UNAVAILABLE');return imports;};
 if(nativeHayesCaller&&nativeOexWorkspace)app.post(`${prefix}/imports/native-hayes-original`,{bodyLimit:4096,schema:{body:object({artworkId:id,artworkRevision:{type:'integer',minimum:1,maximum:2147483647},displayReferenceSha256:{...str,pattern:'^[0-9a-f]{64}$'},idempotencyKey:id})}},async(req,reply)=>{guarded(req,true);reply.header('cache-control','no-store');const tenantId=(req.params as {tenantId:string}).tenantId;uuid(tenantId);if(tenantId!==nativeOexWorkspace.tenantId)throw new ApiError(403,'FORBIDDEN');if(runtimeAvailable&&!runtimeAvailable())throw new ApiError(503,'NATIVE_OWNER_UNAVAILABLE');return nativeHayesCaller.create({token:token(req),csrf:typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined},req.body as {artworkId:string;artworkRevision:number;displayReferenceSha256:string;idempotencyKey:string},Date.now()+30000);});
 const importMutation=nativeOexWorkspace&&!freshOexTest?nativeMutation:(work:Parameters<typeof nativeMutation>[0])=>call(true,work);
 if(nativeOexWorkspace&&!freshOexTest&&store)app.post(`${sp}/:id/native-artwork-replacement`,{bodyLimit:4096,schema:{body:object({requestId:id,artworkId:id,artworkRevision:{type:'integer',minimum:1,maximum:2147483647},importJobId:id})}},nativeMutation(async(c,s,req,reply)=>{const result=await replaceApprovedArtwork(c,s,(req.params as {id:string}).id,req.body as ArtworkReplacementInput,requiredMatch(req.headers['if-match']),studio,cms,importer(),store);reply.header('etag',result.etag);return result;}));
 if(nativeOexWorkspace&&!freshOexTest&&store)app.post(`${sp}/:id/native-original-static-approval`,{bodyLimit:4096,schema:{body:object({artworkId:id,artworkRevision:{type:'integer',minimum:1,maximum:2147483647},importJobId:id})}},nativeMutation(async(c,s,req)=>approveOriginalStaticSource(c,s,(req.params as {id:string}).id,req.body as OriginalStaticApprovalInput,studio,cms,importer(),store)));
 app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:MAX_UPLOAD},(_req,body,done)=>done(null,body));
 app.post(`${prefix}/imports`,{schema:{body:object({artworkId:id,idempotencyKey:{...str,minLength:1,maxLength:128},mime:{enum:['model/gltf-binary','image/png','image/jpeg']},sha256:{...str,pattern:'^[0-9a-f]{64}$'},bytes:{type:'integer',minimum:1,maximum:MAX_UPLOAD},scaleMeters:{type:'number',exclusiveMinimum:0,maximum:1000000},rights:{type:'object'},derived:PREPARED_IMAGE_SCHEMA,modelDerivation:MODEL_DERIVATION_SCHEMA,coarsePreparation:IMAGE_COARSE_INTENT_SCHEMA},['artworkId','idempotencyKey','mime','sha256','bytes','scaleMeters','rights'])}},importMutation(async(c,s,req,reply)=>{reply.code(201);return importer().create(c,s,req.body as ImportInput);}));
 app.get(`${prefix}/imports/:id`,call(false,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return importer().view(await importer().access(c,s,p.id));}));
 app.put(`${prefix}/imports/:id/bytes`,{bodyLimit:MAX_UPLOAD},importMutation(async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');return importer().upload(c,s,p.id,req.body);}));
 app.put(`${prefix}/imports/:id/derived-bytes`,{bodyLimit:MAX_PREPARED_IMAGE_BYTES},importMutation(async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');return importer().uploadDerived(c,s,p.id,req.body);}));
 app.post(`${prefix}/imports/:id/complete`,importMutation(async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return importer().complete(c,s,p.id);}));
 for(const action of ['cancel','retry'] as const)app.post(`${prefix}/imports/:id/${action}`,importMutation(async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return importer().action(c,s,p.id,action);}));

 for(const kind of ['artworks','exhibitions'] as const) {
  app.get(`${prefix}/${kind}/:id`,call(false,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return auth.resource(c,s,kind,p.id);}));
  app.patch(`${prefix}/${kind}/:id`,{schema:{body:bodyMetadata}},call(true,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);const b=req.body as {revision:number;metadata:Record<string,unknown>};return auth.resource(c,s,kind,p.id,b.revision,b.metadata);}));
 }
 app.get(`${prefix}/assets/:id`,call(false,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return auth.asset(c,s,p.id);}));
 app.get(`${prefix}/assets/:id/bytes`,call(false,async(c,s,req,reply)=>{const p=req.params as {id:string};uuid(p.id);await auth.asset(c,s,p.id,'download');if(!store) throw new ApiError(503,'STORAGE_UNAVAILABLE');const bytes=await auth.bytes(c,s,p.id,store);reply.header('content-type','application/octet-stream').header('content-disposition','attachment').header('x-content-type-options','nosniff');return bytes;}));
 app.post(`${prefix}/assets/:id/export-check`,call(true,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return auth.asset(c,s,p.id,'export');}));
 app.put(`${prefix}/memberships/:userId`,{schema:{body:object({role:{enum:roles}})}},call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {userId:string};uuid(p.userId);const b=req.body as {role:string};
  const member=await c.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId]);
  if(!member.rowCount) throw new ApiError(403,'FORBIDDEN');
  if(member.rows[0].role==='admin' && b.role!=='admin') {
   const count=await c.query("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role='admin' AND NOT u.disabled AND m.user_id<>$2",[s.tenantId,p.userId]);
   if(!count.rowCount) throw new ApiError(409,'LAST_ADMIN');
  }
  await c.query('UPDATE memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId,b.role]);
  await c.query('UPDATE auth_sessions SET revoked=true WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId]);
  await auth.audit(c,s,'membership.changed',p.userId);return {updated:true};
 }));
 app.put(`${prefix}/exhibitions/:id/assignments/:userId`,{schema:{body:object({canView:{type:'boolean'}})}},call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {id:string;userId:string};uuid(p.id);uuid(p.userId);
  await auth.resource(c,s,'exhibitions',p.id);
  const member=await c.query('SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId]);if(!member.rowCount) throw new ApiError(403,'FORBIDDEN');
  await c.query('INSERT INTO exhibition_assignments VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,exhibition_id,user_id) DO UPDATE SET can_view=excluded.can_view',[s.tenantId,p.id,p.userId,(req.body as {canView:boolean}).canView]);
  await auth.audit(c,s,'assignment.changed',p.userId);return {updated:true};
 }));
 app.post(`${prefix}/exhibitions/:id/assignments/:userId/revoke`,call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {id:string;userId:string};uuid(p.id);uuid(p.userId);await auth.resource(c,s,'exhibitions',p.id);
  await c.query('DELETE FROM exhibition_assignments WHERE tenant_id=$1 AND exhibition_id=$2 AND user_id=$3',[s.tenantId,p.id,p.userId]);
  await auth.audit(c,s,'assignment.revoked',p.userId);return {revoked:true};
 }));
 app.post(`${prefix}/sessions/:id/revoke`,call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {id:string};uuid(p.id);
  const result=await c.query('UPDATE auth_sessions SET revoked=true WHERE tenant_id=$1 AND id=$2 RETURNING id',[s.tenantId,p.id]);if(!result.rowCount) throw new ApiError(403,'FORBIDDEN');
  await auth.audit(c,s,'session.revoked',p.id);return {revoked:true};
 }));
 app.post(`${prefix}/users/:userId/disable`,call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {userId:string};uuid(p.userId);
  // Users can belong to multiple institutions: tenant admin cannot disable globally.
  const member=await c.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId]);if(!member.rowCount) throw new ApiError(403,'FORBIDDEN');
  const other=await c.query('SELECT 1 FROM memberships WHERE user_id=$1 AND tenant_id<>$2',[p.userId,s.tenantId]);if(other.rowCount) throw new ApiError(409,'MULTI_TENANT_USER');
  if(member.rows[0].role==='admin') {const others=await c.query("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id<>$2 AND m.role='admin' AND NOT u.disabled",[s.tenantId,p.userId]);if(!others.rowCount) throw new ApiError(409,'LAST_ADMIN');}
  await c.query('UPDATE users SET disabled=true WHERE id=$1',[p.userId]);await c.query('UPDATE auth_sessions SET revoked=true WHERE user_id=$1',[p.userId]);await auth.audit(c,s,'user.disabled',p.userId);return {disabled:true};
 }));
 app.post(`${prefix}/users`,{schema:{body:object({subject:{...str,minLength:3,maxLength:128},password:{...str,minLength:12,maxLength:1024},role:{enum:roles}})}},async(req,reply)=>{
  // Check admin before a costly hash; recheck atomically before adding account.
  guarded(req,true);const p=req.params as {tenantId:string};uuid(p.tenantId);const b=req.body as {subject:string;password:string;role:Role};subjectInput(b.subject);passwordInput(b.password);
  const csrf=typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined;
  await auth.request(token(req),p.tenantId,csrf,true,(c,s)=>auth.admin(c,s));
  const salt=randomBytes(16), hash=await auth.hash(b.password,salt);
  return auth.request(token(req),p.tenantId,csrf,true,async(c,s)=>{
   await auth.admin(c,s);const userId=randomUUID();
   const exists=await c.query('SELECT 1 FROM users WHERE subject=$1',[b.subject]);if(exists.rowCount) throw new ApiError(409,'SUBJECT_CONFLICT');
   await c.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,b.subject]);await c.query('INSERT INTO memberships VALUES($1,$2,$3)',[s.tenantId,userId,b.role]);await c.query("INSERT INTO auth_credentials VALUES($1,$2,$3,'argon2id',19456,2,1)",[userId,salt,hash]);await auth.audit(c,s,'user.created',userId);
   reply.header('cache-control','no-store').code(201);return {userId};
  });
 });
 return settings;
}
