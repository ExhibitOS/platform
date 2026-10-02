// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import type {Pool,PoolClient} from 'pg';
import {transaction,sha256,type BlobStore} from '@exhibitos/storage';
import {writeOex,validateExhibition,type Exhibition} from '@exhibitos/spec';
import {MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE,EXPERIENCE_NAMESPACE,LOD_NAMESPACE,ARTWORK_DETAILS_NAMESPACE,validateStudioMaterials,validateStudioPresentation,validateViewerExperience,validateViewerLod,validateArtworkDetails,creationYearFor} from '@exhibitos/studio-contract';
import {ApiError,uuid,type Session} from './auth.ts';
import {Studio,etag,type Draft} from './studio.ts';
import {Cms,validMetadata,type ArtworkMetadata} from './cms.ts';
import {validRights,allowedRights} from './rights.ts';
import {decode,MAX_UPLOAD} from './imports.ts';
import {validatePcmWav,audioMedia,type AudioRow} from './audio.ts';
export const MAX_OEX_UPLOAD=67108864;
const CHUNK=16*1024*1024, CMS='org.exhibitos.studio/cms';
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export interface OexInput {requestId:string;bytes:number;sha256:string}
interface Job {tenant_id:string;id:string;user_id:string;request_id:string;payload_sha256:string;expected_bytes:number;state:string;attempts:number;lease_id:string|null;lease_until:Date|null;error_code:string|null;result:unknown;staging_keys:string[];cleanup_keys:string[];cleanup_pending:boolean}
/** Known platform namespaces are validated, never executable. Unknown nested namespaces fail closed. */
export function checkOexProfile(e:Exhibition,privateBindings=false){
 if(e.artworks.length>64||e.mediaAssets.length>32||!validateExhibition(e).valid||!validateStudioMaterials(e).valid||!validateStudioPresentation(e).valid||!validateViewerExperience(e).valid||e.artworks.some(a=>!validateViewerLod(a).valid||!validateArtworkDetails(a).valid))throw new ApiError(422,'OEX_PROFILE_INVALID');
 const scan=(v:unknown,scope:'exhibition'|'artwork'|'nested')=>{
  if(Array.isArray(v)){for(const x of v)scan(x,'nested');return;}
  if(!object(v))return;
  if(Object.hasOwn(v,'extensions')){
   if(!object(v.extensions))throw new ApiError(422,'OEX_EXTENSION_UNSUPPORTED');
   const allowed=scope==='exhibition'?[MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE,EXPERIENCE_NAMESPACE]:scope==='artwork'?[LOD_NAMESPACE,ARTWORK_DETAILS_NAMESPACE,...(privateBindings?[CMS]:[])]:[];
   if(Object.keys(v.extensions).some(k=>!allowed.includes(k)))throw new ApiError(422,'OEX_EXTENSION_UNSUPPORTED');
  }
  for(const [k,x]of Object.entries(v)){if(k==='extensions')continue;if(k==='artworks'&&scope==='exhibition'){for(const a of x as unknown[])scan(a,'artwork');}else scan(x,'nested');}
 };
 scan(e,'exhibition');
 for(const a of e.artworks){if(!validRights(a.rights)||a.assets.length>8||a.assets.some(x=>!['image/png','model/gltf-binary'].includes(x.mime)||x.bytes>MAX_UPLOAD))throw new ApiError(422,'OEX_PROFILE_INVALID');}
 for(const m of e.mediaAssets)if(m.mime!=='audio/wav'||!validRights(m.rights))throw new ApiError(422,'OEX_PROFILE_INVALID');
}
/** Only typed UUID fields and material surface keys are rewritten. UUID-shaped human prose is untouched. */
export function remapOex(e:Exhibition){
 const ids=new Map<string,string>();
 const collect=(v:unknown)=>{if(Array.isArray(v))for(const x of v)collect(x);else if(object(v))for(const[k,x]of Object.entries(v)){if((k==='id'||k==='revisionId')&&typeof x==='string'){uuid(x);if(!ids.has(x.toLowerCase()))ids.set(x.toLowerCase(),randomUUID());}else if(k!=='extensions')collect(x);}};
 collect(e);
 const presentation=e.extensions?.[PRESENTATION_NAMESPACE] as {viewpoints?:{id:string}[]}|undefined;
 for(const v of presentation?.viewpoints??[])if(!ids.has(v.id.toLowerCase()))ids.set(v.id.toLowerCase(),randomUUID());
 const visit=(v:unknown,field=''):unknown=>typeof v==='string'?(/^(id|revisionId|.*Id|.*Ids)$/.test(field)?ids.get(v.toLowerCase())??v:v):Array.isArray(v)?v.map(x=>visit(x,field)):object(v)?Object.fromEntries(Object.entries(v).map(([k,x])=>[ids.get(k.toLowerCase())??k,visit(x,k)])):v;
 const exhibition=visit(structuredClone(e))as Exhibition;
 const counts=new Map<string,number>();for(const artwork of e.artworks)for(const asset of artwork.assets)counts.set(asset.id.toLowerCase(),(counts.get(asset.id.toLowerCase())??0)+1);
 const assetAliases:{sourceAssetId:string;sourceArtworkRevisionId:string;destinationArtworkId:string;destinationArtworkRevisionId:string;destinationAssetId:string;sourceArtifactPath:string;destinationArtifactPath:string}[]=[];
 const scoped=new Map<string,Map<string,string>>();
 for(const[index,source]of e.artworks.entries()){
  const target=exhibition.artworks[index]!,aliases=new Map<string,string>();scoped.set(source.revisionId.toLowerCase(),aliases);
  for(const[ai,asset]of source.assets.entries()){
   const destination=target.assets[ai]!;let newId=ids.get(asset.id.toLowerCase())!;
   if((counts.get(asset.id.toLowerCase())??0)>1){if(assetAliases.some(x=>x.sourceAssetId.toLowerCase()===asset.id.toLowerCase()))newId=randomUUID();destination.id=newId;destination.path=`imported/${newId}/${asset.path.split('/').at(-1)!}`;}
   aliases.set(asset.id.toLowerCase(),newId);
   assetAliases.push({sourceAssetId:asset.id,sourceArtworkRevisionId:source.revisionId,destinationArtworkId:target.id,destinationArtworkRevisionId:target.revisionId,destinationAssetId:newId,sourceArtifactPath:asset.path,destinationArtifactPath:destination.path});
  }
  const scopedId=(value:string)=>aliases.get(value.toLowerCase())??ids.get(value.toLowerCase())??value;
  target.primaryAssetId=scopedId(source.primaryAssetId);
  const lod=target.extensions?.[LOD_NAMESPACE]as {variants:{assetId:string}[]}|undefined,sourceLod=source.extensions?.[LOD_NAMESPACE]as {variants:{assetId:string}[]}|undefined;
  if(lod&&sourceLod)for(const[i,variant]of sourceLod.variants.entries())lod.variants[i]!.assetId=scopedId(variant.assetId);
  for(const[i,event]of source.provenance.events.entries())if(event.sourceAssetIds)target.provenance.events[i]!.sourceAssetIds=event.sourceAssetIds.map(scopedId);
  if(source.provenance.scaleConversion&&target.provenance.scaleConversion)target.provenance.scaleConversion.appliedToAssetIds=source.provenance.scaleConversion.appliedToAssetIds.map(scopedId);
 }
 for(const[index,placement]of e.placements.entries())exhibition.placements[index]!.assetId=scoped.get(placement.artworkRevisionId.toLowerCase())?.get(placement.assetId.toLowerCase())??ids.get(placement.assetId.toLowerCase())??placement.assetId;
 return {exhibition,idMap:Object.fromEntries(ids),assetAliases};
}
export function decodeOex(bytes:Buffer):Promise<{exhibition:Exhibition;files:Map<string,Buffer>}>{
 return new Promise((resolve,reject)=>{
  const url=new URL('./oex-validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))url.pathname=url.pathname.replace(/\.js$/,'.ts');
  const child=execFile(process.execPath,['--max-old-space-size=512',url.pathname],{timeout:30000,maxBuffer:100*1024*1024,encoding:'buffer',env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(error,output)=>{
   if(error){reject(new ApiError(422,'OEX_INVALID'));return;}
   try{const parsed=JSON.parse(output.toString('utf8'))as {exhibition:Exhibition;files:[string,string][]};let total=0;if(!Array.isArray(parsed.files)||parsed.files.length>1024)throw Error('limit');const files=new Map<string,Buffer>();for(const [path,b64]of parsed.files){const content=Buffer.from(b64,'base64');total+=content.length;if(total>MAX_OEX_UPLOAD||files.has(path))throw Error('limit');files.set(path,content);}resolve({exhibition:parsed.exhibition,files});}catch{reject(new ApiError(422,'OEX_INVALID'));}
  });child.stdin?.on('error',()=>{});child.stdin?.end(bytes);
 });
}
export class Oex {
 readonly studio=new Studio();readonly cms:Cms;
 readonly pool:Pool;readonly blobs:BlobStore;
 constructor(pool:Pool,blobs:BlobStore){this.pool=pool;this.blobs=blobs;this.cms=new Cms(blobs);}
 private role(s:Session){if(!['admin','artist'].includes(s.role))throw new ApiError(403,'FORBIDDEN');}
 view(row:Job){return {id:row.id,state:row.state,errorCode:row.error_code,attempts:row.attempts,result:row.result,cleanupPending:row.cleanup_pending};}
 async access(c:PoolClient,s:Session,id:string):Promise<Job>{this.role(s);uuid(id);const row=(await c.query('SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,id])).rows[0];if(!row||(s.role!=='admin'&&row.user_id!==s.userId))throw new ApiError(403,'FORBIDDEN');return row;}
 async list(c:PoolClient,s:Session){this.role(s);return {items:(await c.query('SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND ($2 OR user_id=$3) ORDER BY created_at DESC,id LIMIT 50',[s.tenantId,s.role==='admin',s.userId])).rows.map(r=>({...this.view(r),result:undefined,exhibitionId:r.result?.exhibitionId??null}))};}
 async create(c:PoolClient,s:Session,input:OexInput){
  this.role(s);uuid(input.requestId);if(!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>MAX_OEX_UPLOAD||!/^[a-f0-9]{64}$/.test(input.sha256))throw new ApiError(400,'INVALID_INPUT');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:oex-quota`]);
  const prior=(await c.query('SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[s.tenantId,s.userId,input.requestId])).rows[0];
  if(prior){if(prior.payload_sha256!==input.sha256||prior.expected_bytes!==input.bytes)throw new ApiError(409,'REQUEST_CONFLICT');return this.view(prior);}
  const quota=(await c.query("SELECT count(*) AS count,coalesce(sum(expected_bytes),0) AS bytes FROM oex_import_jobs WHERE tenant_id=$1 AND (state IN ('uploading','queued','processing','failed') OR cleanup_pending)",[s.tenantId])).rows[0];
  if(Number(quota.count)>=16||Number(quota.bytes)+input.bytes>512*1024*1024)throw new ApiError(409,'OEX_JOB_LIMIT');
  const id=randomUUID(),keys=Array.from({length:Math.ceil(input.bytes/CHUNK)},(_,i)=>`${s.tenantId}/oex-staging/${id}/chunk-${i}`);
  const r=(await c.query('INSERT INTO oex_import_jobs(tenant_id,id,user_id,request_id,payload_sha256,expected_bytes,staging_keys) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[s.tenantId,id,s.userId,input.requestId,input.sha256,input.bytes,JSON.stringify(keys)])).rows[0];return this.view(r);
 }
 async upload(c:PoolClient,s:Session,id:string,bytes:Buffer){const row=await this.access(c,s,id);if(row.state!=='uploading')throw new ApiError(409,'JOB_STATE');if(bytes.length!==row.expected_bytes||sha256(bytes)!==row.payload_sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');for(const[k,key]of row.staging_keys.entries())await this.blobs.put(key,bytes.subarray(k*CHUNK,(k+1)*CHUNK));return {received:bytes.length};}
 private async uploaded(row:Job){const chunks=[];for(const key of row.staging_keys)chunks.push(Buffer.from(await this.blobs.get(key)));const bytes=Buffer.concat(chunks);if(bytes.length!==row.expected_bytes||sha256(bytes)!==row.payload_sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');return bytes;}
 async complete(c:PoolClient,s:Session,id:string){const row=await this.access(c,s,id);if(['queued','processing','complete'].includes(row.state))return this.view(row);if(row.state!=='uploading')throw new ApiError(409,'JOB_STATE');try{await this.uploaded(row);}catch{throw new ApiError(409,'UPLOAD_INCOMPLETE');}return this.view((await c.query("UPDATE oex_import_jobs SET state='queued',updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[s.tenantId,id])).rows[0]);}
 async action(c:PoolClient,s:Session,id:string,action:'cancel'|'retry'){
  const row=await this.access(c,s,id);if(row.state==='complete')throw new ApiError(409,'JOB_STATE');
  if(action==='retry'){if(row.state!=='failed'||row.attempts>=5)throw new ApiError(409,'JOB_STATE');await c.query("UPDATE oex_import_jobs SET state='queued',error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);}
  else {await c.query("UPDATE oex_import_jobs SET state='cancelled',lease_id=NULL,lease_until=NULL,cleanup_pending=true,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);}
  return this.view((await c.query('SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0]);
 }
 async export(c:PoolClient,s:Session,id:string,match:string):Promise<Buffer>{
  const row=await this.studio.access(c,s,id);if(etag(row.revision,row.metadata)!==match)throw new ApiError(412,'REMOTE_CONFLICT');
  const snapshot=(await c.query('SELECT snapshot FROM exhibition_revisions WHERE tenant_id=$1 AND exhibition_id=$2 AND revision=$3',[s.tenantId,id,row.revision])).rows[0]?.snapshot;
  if(!equal(snapshot,row.metadata))throw new ApiError(409,'DRAFT_CORRUPT');
  const e=structuredClone(snapshot.candidate)as Exhibition;checkOexProfile(e,true);const files=new Map<string,Uint8Array>();
  const rights:unknown[]=[];let total=0;
  for(const a of e.artworks){
   const binding=a.extensions?.[CMS]as {tenantId?:string;artworkId?:string;revision?:number}|undefined;
   if(!binding||binding.tenantId?.toLowerCase()!==s.tenantId.toLowerCase()||binding.artworkId?.toLowerCase()!==a.id.toLowerCase()||binding.revision!==a.revision)throw new ApiError(422,'CMS_BINDING_REQUIRED');
   const current=await this.cms.ownArtwork(c,s,a.id);const approval=(await c.query('SELECT * FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,a.id,a.revision])).rows[0];
   if(!current.cms_managed||current.revision!==a.revision||current.approved_revision!==a.revision||current.approved_asset_id?.toLowerCase()!==a.primaryAssetId.toLowerCase()||!approval||!validMetadata(current.metadata)||!equal(approval.snapshot.metadata,current.metadata)||!equal(current.metadata.rights,a.rights))throw new ApiError(409,'OEX_SOURCE_CHANGED');
   const m=current.metadata as ArtworkMetadata;
   if(a.metadata.title!==m.title||a.metadata.description!==m.description||a.metadata.medium!==m.medium||a.dimensions.width!==m.dimensions.width||a.dimensions.height!==m.dimensions.height||a.dimensions.depth!==m.dimensions.depth||creationYearFor(a)!==m.creationYear||a.provenance.authorship!==m.provenance.source)throw new ApiError(409,'OEX_SOURCE_CHANGED');
   const primary=a.assets.find(x=>x.id.toLowerCase()===a.primaryAssetId.toLowerCase())!;
   if(!equal({id:primary.id.toLowerCase(),sha256:primary.sha256,bytes:primary.bytes,mime:primary.mime},{id:approval.snapshot.asset?.id?.toLowerCase(),sha256:approval.snapshot.asset?.sha256,bytes:approval.snapshot.asset?.bytes,mime:approval.snapshot.asset?.mime}))throw new ApiError(409,'OEX_SOURCE_CHANGED');
   for(const asset of a.assets){
    const stored=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL",[s.tenantId,a.id,asset.id])).rows[0];
    if(!stored||stored.sha256!==asset.sha256||Number(stored.bytes)!==asset.bytes||stored.mime!==asset.mime||!equal(stored.rights,a.rights))throw new ApiError(409,'OEX_SOURCE_CHANGED');
    if(!allowedRights(m.rights,'export')||!allowedRights(stored.rights,'export')||!allowedRights(a.rights,'export'))throw new ApiError(403,'RIGHTS_DENIED');
    rights.push(m.rights,stored.rights,a.rights);const bytes=Buffer.from(await this.blobs.get(stored.object_key));if(bytes.length!==asset.bytes||sha256(bytes)!==asset.sha256)throw new ApiError(409,'ASSET_INTEGRITY');await decode(bytes,asset.mime);total+=bytes.length;if(total>MAX_OEX_UPLOAD)throw new ApiError(422,'OEX_LIMIT');if(files.has(asset.path)&&sha256(files.get(asset.path)!)!==asset.sha256)throw new ApiError(422,'OEX_PATH_CONFLICT');files.set(asset.path,bytes);
   }
   if(a.extensions){delete a.extensions[CMS];if(!Object.keys(a.extensions).length)delete a.extensions;}
  }
  for(const m of e.mediaAssets){
   const source=(await c.query("SELECT * FROM studio_audio WHERE tenant_id=$1 AND exhibition_id=$2 AND id=$3 AND state='approved' AND NOT revoked",[s.tenantId,id,m.id])).rows[0]as AudioRow|undefined;
   const ap=(await c.query('SELECT snapshot FROM audio_approvals WHERE tenant_id=$1 AND audio_id=$2',[s.tenantId,m.id])).rows[0];
   if(!source||!ap||!equal(ap.snapshot,audioMedia(source))||!equal(audioMedia(source),m))throw new ApiError(409,'OEX_SOURCE_CHANGED');
   if(!allowedRights(source.rights,'export'))throw new ApiError(403,'RIGHTS_DENIED');rights.push(source.rights);
   const bytes=Buffer.from(await this.blobs.get(source.object_key));if(bytes.length!==m.bytes||sha256(bytes)!==m.sha256)throw new ApiError(409,'ASSET_INTEGRITY');validatePcmWav(bytes);total+=bytes.length;if(total>MAX_OEX_UPLOAD)throw new ApiError(422,'OEX_LIMIT');files.set(m.path,bytes);
  }
  let bytes:Buffer;try{bytes=Buffer.from(await writeOex(e,files,{createdAt:new Date().toISOString(),generator:{name:'ExhibitOS Platform',version:'0.1.0'}}));}catch{throw new ApiError(422,'OEX_INVALID');}
  if(bytes.length>MAX_OEX_UPLOAD)throw new ApiError(422,'OEX_LIMIT');if(rights.some(r=>!allowedRights(r,'export')))throw new ApiError(403,'RIGHTS_DENIED');return bytes;
 }
 private async remove(key:string){try{await this.blobs.remove(key);}catch(error){if(!object(error)||(error.code!=='ENOENT'&&error.name!=='NoSuchKey'))throw error;}}
 private async actor(c:PoolClient,row:Job):Promise<Session>{
  const m=(await c.query('SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND NOT u.disabled AND t.deleted_at IS NULL',[row.tenant_id,row.user_id])).rows[0];
  if(!m||!['admin','artist'].includes(m.role))throw new ApiError(403,'FORBIDDEN');
  return {id:row.id,tenantId:row.tenant_id,userId:row.user_id,role:m.role,csrfToken:'',expiresAt:new Date(Date.now()+600000).toISOString()};
 }
 /** Retryable cleanup receipt survives deletion failures and crashes. No shared or pre-existing object keys. */
 async cleanup(id:string){
  return transaction(this.pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
   const r=(await c.query("SELECT * FROM oex_import_jobs WHERE id=$1 AND state IN ('failed','cancelled','complete') AND cleanup_pending FOR UPDATE",[id])).rows[0]as Job|undefined;if(!r)return false;
   const keys=[...(r.state==='complete'?[]:r.cleanup_keys),...(['complete','cancelled'].includes(r.state)?r.staging_keys:[])];
   let failed=false;for(const key of keys){if(!key.startsWith(`${r.tenant_id}/oex-staging/${r.id}/`)&&!key.startsWith(`${r.tenant_id}/oex-import/${r.id}/`))throw new ApiError(409,'CLEANUP_SCOPE_INVALID');try{await this.remove(key);}catch{failed=true;}}
   await c.query('UPDATE oex_import_jobs SET cleanup_pending=$3,cleanup_keys=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2',[r.tenant_id,r.id,failed,JSON.stringify(failed?r.cleanup_keys:[])]);return true;
  });
 }
 async runNext(){
  const clean=(await this.pool.query("SELECT id FROM oex_import_jobs WHERE cleanup_pending AND state IN ('failed','cancelled','complete') ORDER BY updated_at LIMIT 1")).rows[0];if(clean)await this.cleanup(clean.id);
  const row=(await this.pool.query("SELECT id FROM oex_import_jobs WHERE state='queued' OR state='processing' AND lease_until<clock_timestamp() ORDER BY created_at LIMIT 1")).rows[0];if(!row)return false;return this.run(row.id);
 }
 async run(id:string){
  uuid(id);const lease=randomUUID();
  const row=await transaction(this.pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
   const r=(await c.query("SELECT * FROM oex_import_jobs WHERE id=$1 AND (state='queued' OR state='processing' AND lease_until<clock_timestamp()) FOR UPDATE SKIP LOCKED",[id])).rows[0]as Job|undefined;if(!r)return null;
   if(r.attempts>=5){await c.query("UPDATE oex_import_jobs SET state='failed',error_code='RETRY_EXHAUSTED',cleanup_pending=true,lease_id=NULL,lease_until=NULL WHERE tenant_id=$1 AND id=$2",[r.tenant_id,id]);return null;}
   // Remove previous attempt's exclusively owned disposable keys before another attempt.
   for(const key of r.cleanup_keys){if(!key.startsWith(`${r.tenant_id}/oex-import/${id}/`))throw new ApiError(409,'CLEANUP_SCOPE_INVALID');try{await this.remove(key);}catch{await c.query("UPDATE oex_import_jobs SET state='failed',error_code='CLEANUP_PENDING',cleanup_pending=true,lease_id=NULL,lease_until=NULL WHERE tenant_id=$1 AND id=$2",[r.tenant_id,id]);return null;}}
   return (await c.query("UPDATE oex_import_jobs SET state='processing',attempts=attempts+1,lease_id=$3,lease_until=clock_timestamp()+interval '10 minutes',cleanup_keys='[]',cleanup_pending=false,error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[r.tenant_id,id,lease])).rows[0]as Job;
  });if(!row)return false;
  try{
   const parsed=await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');const bytes=await this.uploaded(row);try{return await decodeOex(bytes);}catch{throw new ApiError(422,'OEX_INVALID');}});
   checkOexProfile(parsed.exhibition);
   const grants:unknown[]=[...parsed.exhibition.artworks.map(a=>a.rights),...parsed.exhibition.mediaAssets.map(m=>m.rights)];
   if(grants.some(r=>!allowedRights(r,'export')))throw new ApiError(403,'RIGHTS_DENIED');
   const qualified=new Map<string,Buffer>();
   for(const a of parsed.exhibition.artworks)for(const asset of a.assets){const bytes=parsed.files.get(`assets/${asset.path}`);if(!bytes||bytes.length!==asset.bytes||sha256(bytes)!==asset.sha256)throw new ApiError(422,'ASSET_INTEGRITY');if(!qualified.has(asset.path))await decode(bytes,asset.mime);qualified.set(asset.path,bytes);}
   for(const m of parsed.exhibition.mediaAssets){const bytes=parsed.files.get(`assets/${m.path}`);if(!bytes||bytes.length!==m.bytes||sha256(bytes)!==m.sha256)throw new ApiError(422,'ASSET_INTEGRITY');validatePcmWav(bytes);qualified.set(m.path,bytes);}
   const {exhibition:e,idMap,assetAliases}=remapOex(parsed.exhibition),keys=new Map<string,string>(),sourceKeys=new Map<string,string>(),restoredBytes=new Map<string,Buffer>();
   for(const path of qualified.keys())sourceKeys.set(path,`${row.tenant_id}/oex-import/${id}/${lease}/${randomUUID()}`);
   for(const alias of assetAliases){keys.set(alias.destinationArtifactPath,sourceKeys.get(alias.sourceArtifactPath)!);restoredBytes.set(alias.destinationArtifactPath,qualified.get(alias.sourceArtifactPath)!);}
   for(const m of e.mediaAssets){keys.set(m.path,sourceKeys.get(m.path)!);restoredBytes.set(m.path,qualified.get(m.path)!);}
   const storedBytes=new Map([...sourceKeys].map(([path,key])=>[key,qualified.get(path)!]));
   // Commit the cleanup inventory before any destination byte write, including process death.
   const inventoried=await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');return (await c.query("UPDATE oex_import_jobs SET cleanup_keys=$4 WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() RETURNING id",[row.tenant_id,id,lease,JSON.stringify([...storedBytes.keys()])])).rowCount;});
   if(!inventoried)return true;
   await transaction(this.pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
    const current=(await c.query("SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() FOR UPDATE",[row.tenant_id,id,lease])).rows[0]as Job|undefined;if(!current)return;
    const s=await this.actor(c,current),at=new Date().toISOString();
    if(grants.some(r=>!allowedRights(r,'export')))throw new ApiError(403,'RIGHTS_DENIED');
    for(const[key,bytes]of storedBytes)await this.blobs.put(key,bytes);
    for(const a of e.artworks){
     const m:ArtworkMetadata={title:a.metadata.title,description:a.metadata.description??'',...(a.metadata.medium===undefined?{}:{medium:a.metadata.medium}),...(creationYearFor(a)===undefined?{}:{creationYear:creationYearFor(a)}),dimensions:{width:a.dimensions.width,height:a.dimensions.height,...(a.dimensions.depth===undefined?{}:{depth:a.dimensions.depth}),unit:'m'},rights:structuredClone(a.rights),provenance:{source:a.provenance.authorship,sourceUnits:'m',scaleApplied:true,notes:'Imported from an integrity-checked OEX package; source provenance remains in the exhibition snapshot.'}};
     if(!validMetadata(m))throw new ApiError(422,'OEX_CMS_METADATA_INVALID');
     const artist=randomUUID();await c.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[s.tenantId,artist,s.userId,{name:a.metadata.artist??'Imported artist',bio:''}]);await c.query('INSERT INTO artist_revisions(tenant_id,artist_id,revision,snapshot) VALUES($1,$2,1,$3)',[s.tenantId,artist,{name:a.metadata.artist??'Imported artist',bio:'',userId:s.userId}]);
     // New local resource revision starts at 1; source immutable revision/provenance remains package evidence.
     a.revision=1;
     await c.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata,cms_managed) VALUES($1,$2,$3,$4,true)',[s.tenantId,a.id,artist,m]);await c.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)',[s.tenantId,a.id,m]);
     for(const asset of a.assets){const rights=randomUUID();await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[s.tenantId,rights,a.rights]);await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,1,'approved')",[s.tenantId,asset.id,a.id,rights,keys.get(asset.path),asset.sha256,asset.bytes,asset.mime]);}
     const primary=a.assets.find(x=>x.id===a.primaryAssetId)!;
     await c.query('INSERT INTO artwork_approvals(tenant_id,artwork_id,revision,asset_id,snapshot) VALUES($1,$2,1,$3,$4)',[s.tenantId,a.id,primary.id,{metadata:m,asset:{id:primary.id,sha256:primary.sha256,bytes:primary.bytes,mime:primary.mime,rightsRevision:1}}]);
     await c.query('UPDATE artworks SET approved_revision=1,approved_asset_id=$3 WHERE tenant_id=$1 AND id=$2',[s.tenantId,a.id,primary.id]);
     a.extensions={...a.extensions,[CMS]:{tenantId:s.tenantId,artworkId:a.id,revision:1}};
    }
    e.revision=1; // New local revision identity, scene settings and authored prose preserved.
    // Paths stay package-relative and bytes/hash exact; private storage keys never enter the draft.
    const draft:Draft={schemaVersion:'1.0.0-draft.1',kind:'exhibition-draft',id:randomUUID(),exhibitionId:e.id,editVersion:1,createdAt:at,updatedAt:at,candidate:e};
    const mediaSources=new Map(e.mediaAssets.map(m=>[m.id,{key:keys.get(m.path)!,bytes:restoredBytes.get(m.path)!}]));
    for(const m of e.mediaAssets)m.path=`media/${m.id}/audio.wav`;
    const response=await this.studio.create(c,s,{draft,requestId:randomUUID()});
    for(const m of e.mediaAssets){
     const source=mediaSources.get(m.id)!,key=source.key,pcm=validatePcmWav(source.bytes);
     await c.query("INSERT INTO studio_audio(tenant_id,exhibition_id,id,request_id,created_by,payload_sha256,sha256,bytes,mime,rights,object_key,state,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'audio/wav',$9,$10,'approved',$11)",[s.tenantId,e.id,m.id,randomUUID(),s.userId,sha256(Buffer.from(JSON.stringify(canonical(m)))),m.sha256,m.bytes,m.rights,key,pcm.durationSeconds]);
     // Match the local Audio serializer exactly, including its deterministic inventory path.
     await c.query('INSERT INTO audio_approvals(tenant_id,audio_id,snapshot,approved_by) VALUES($1,$2,$3,$4)',[s.tenantId,m.id,m,s.userId]);
    }
    if(grants.some(r=>!allowedRights(r,'export')))throw new ApiError(403,'RIGHTS_DENIED');
    const valid=(await c.query('SELECT lease_until>clock_timestamp() AS valid FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0]?.valid;if(!valid)throw new ApiError(409,'LEASE_EXPIRED');
    await c.query("UPDATE oex_import_jobs SET state='complete',result=$4,lease_id=NULL,lease_until=NULL,cleanup_pending=true,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND lease_id=$3",[s.tenantId,id,lease,{...response,exhibitionId:e.id,idMap,assetAliases}]);
    await c.query('INSERT INTO audit_events(tenant_id,id,metadata) VALUES($1,$2,$3)',[s.tenantId,randomUUID(),{action:'oex.imported',actor:s.userId,jobId:id,exhibitionId:e.id,payloadSha256:row.payload_sha256}]);
   });
  }catch(error){await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await c.query("UPDATE oex_import_jobs SET state='failed',error_code=$4,lease_id=NULL,lease_until=NULL,cleanup_pending=true,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3",[row.tenant_id,id,lease,error instanceof ApiError?error.code:'OEX_IMPORT_FAILED']);});}
  await this.cleanup(id);return true;
 }
}
