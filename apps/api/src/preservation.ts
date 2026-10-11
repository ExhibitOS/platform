// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {membership,artworkAccess,AccessDenied,sha256,type BlobStore} from '@exhibitos/storage';
import {ARTWORK_VERSION,EXHIBITION_VERSION,OEX_VERSION,OEX_MEDIA_VERSION,HASH_PROFILE,validateArtwork} from '@exhibitos/spec';
import {ApiError,uuid,type Session} from './auth.ts';
import {validMetadata} from './cms.ts';
import {validRights,allowedRights} from './rights.ts';

export type PreservationState='verified'|'missing'|'hash-mismatch'|'unsupported-format'|'unverified';
export interface PreservationFile {id:string;kind:'source'|'derivative';revision:number;mime:string;bytes:number;sha256:string;state:PreservationState;sourceSha256?:string}
const FORMATS=new Set(['model/gltf-binary','image/png','audio/wav']);
const MAX_FILES=128,MAX_BYTES=64*1024*1024;
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const hash=(value:unknown)=>sha256(Buffer.from(JSON.stringify(canonical(value))));
/** Hash/size observation only: neither artistic quality nor a format decoder. */
export async function inspectPreservationFile(store:BlobStore|undefined,input:PreservationFile,key:string,budget:{bytes:number}):Promise<PreservationFile>{
 const out={...input};
 if(!FORMATS.has(input.mime)){out.state='unsupported-format';return out;}
 if(!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(input.sha256)||budget.bytes+input.bytes>MAX_BYTES||!store){out.state='unverified';return out;}
 budget.bytes+=input.bytes;
 try{const bytes=await store.get(key);out.state=bytes.length===input.bytes&&sha256(bytes)===input.sha256?'verified':'hash-mismatch';}catch(error){const e=error as {code?:string;name?:string};out.state=e?.code==='ENOENT'||e?.name==='NoSuchKey'||e?.name==='NotFound'?'missing':'unverified';}
 return out;
}
/** Caller retains normal auth and storage shared transaction locks; no writes, parsing jobs or downloads. */
export class Preservation {
 readonly blobs:BlobStore|undefined;
 constructor(blobs?:BlobStore){this.blobs=blobs;}
 async inventory(c:PoolClient,s:Session,id:string){
  uuid(id);let a:Awaited<ReturnType<typeof artworkAccess>>;
  try{const role=await membership(c,s);if(role!==s.role||!['admin','artist'].includes(role))throw new ApiError(403,'FORBIDDEN');a=await artworkAccess(c,s,id);}catch(error){if(error instanceof AccessDenied)throw new ApiError(403,'FORBIDDEN');throw error;}
  await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  const warnings:Array<{code:string;fileId?:string;revision?:number}>=[];
  const revisions=(await c.query('SELECT r.revision,r.snapshot,r.created_at,ap.snapshot AS approval FROM artwork_revisions r LEFT JOIN artwork_approvals ap ON (ap.tenant_id,ap.artwork_id,ap.revision)=(r.tenant_id,r.artwork_id,r.revision) WHERE r.tenant_id=$1 AND r.artwork_id=$2 ORDER BY r.revision DESC LIMIT 129',[s.tenantId,id])).rows;
  if(revisions.length>128)warnings.push({code:'REVISION_INVENTORY_TRUNCATED'});
  const versions=revisions.slice(0,128).map(r=>{
   const metadata=r.snapshot,imported=r.approval?.importedArtwork;
   if(!validMetadata(metadata))warnings.push({code:'METADATA_INVALID',revision:r.revision});
   if(imported!==undefined&&(!validateArtwork(imported).valid||imported.schemaVersion!==ARTWORK_VERSION))warnings.push({code:'UNSUPPORTED_VERSION',revision:r.revision});
   return {revision:r.revision,createdAt:new Date(r.created_at).toISOString(),metadataSha256:hash(metadata),approvalSha256:r.approval?hash(r.approval):null,sourceFormat:imported?.schemaVersion??null,sourceRevisionId:imported?.revisionId??null,rights:validMetadata(metadata)?metadata.rights:null,provenance:validMetadata(metadata)?metadata.provenance:null};
  });
  const assets=(await c.query('SELECT a.id,a.revision,a.mime,a.bytes,a.sha256,a.object_key,a.state,a.deleted_at,r.metadata AS rights,r.deleted_at AS rights_deleted FROM assets a LEFT JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 ORDER BY a.created_at,a.id LIMIT 129',[s.tenantId,id])).rows;
  const derivatives=(await c.query('SELECT d.id,d.revision,d.metadata,d.deleted_at FROM asset_derivatives d JOIN assets a ON (a.tenant_id,a.id)=(d.tenant_id,d.asset_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 ORDER BY d.created_at,d.id LIMIT 129',[s.tenantId,id])).rows;
  if(assets.length>MAX_FILES||derivatives.length>MAX_FILES)warnings.push({code:'FILE_INVENTORY_TRUNCATED'});
  const files:PreservationFile[]=[],budget={bytes:0};
  for(const row of assets.slice(0,MAX_FILES)){
   const input:PreservationFile={id:row.id,kind:'source',revision:row.revision,mime:row.mime,bytes:Number(row.bytes),sha256:row.sha256,state:'unverified'};
   const file=row.deleted_at?{...input,state:'missing' as const}:await inspectPreservationFile(this.blobs,input,row.object_key,budget);files.push(file);
   if(file.state!=='verified')warnings.push({code:file.state==='missing'?'MISSING_MASTER':file.state==='hash-mismatch'?'HASH_MISMATCH':file.state==='unsupported-format'?'UNSUPPORTED_FORMAT':'BYTES_UNVERIFIED',fileId:file.id});
   if(row.rights_deleted||!validRights(row.rights))warnings.push({code:'RIGHTS_UNAVAILABLE',fileId:file.id});
  }
  for(const row of derivatives.slice(0,MAX_FILES)){
   const m=row.metadata;if(!m||typeof m.objectKey!=='string'||typeof m.sha256!=='string'||typeof m.mime!=='string'){warnings.push({code:'DERIVATIVE_INVENTORY_INVALID',fileId:row.id});continue;}
   const input:PreservationFile={id:row.id,kind:'derivative',revision:row.revision,mime:m.mime,bytes:Number(m.bytes),sha256:m.sha256,state:'unverified',...(typeof m.sourceSha256==='string'?{sourceSha256:m.sourceSha256}:{})};
   const file=row.deleted_at?{...input,state:'missing' as const}:await inspectPreservationFile(this.blobs,input,m.objectKey,budget);files.push(file);if(file.state!=='verified')warnings.push({code:file.state==='missing'?'MISSING_DERIVATIVE':file.state==='hash-mismatch'?'HASH_MISMATCH':file.state==='unsupported-format'?'UNSUPPORTED_FORMAT':'BYTES_UNVERIFIED',fileId:file.id});
  }
  if(!assets.length)warnings.push({code:'MISSING_MASTER'});
  const metadata=validMetadata(a.metadata)?a.metadata:null;
  if(!metadata)warnings.push({code:'METADATA_INVALID',revision:a.revision});
  return {artworkId:id,revision:a.revision,observedAt:new Date().toISOString(),assessment:'technical-preservation-only' as const,observationComplete:!warnings.length,versions,files,warnings,
   formats:{oes:EXHIBITION_VERSION,artwork:ARTWORK_VERSION,oex:[OEX_VERSION,OEX_MEDIA_VERSION],hashProfile:HASH_PROFILE},
   currentMetadataSha256:hash(a.metadata),rights:metadata?.rights??null,provenance:metadata?.provenance??null,
   currentDisplayAllowed:!!metadata&&allowedRights(metadata.rights,'display'),currentExportAllowed:!!metadata&&allowedRights(metadata.rights,'export'),
   fields:{originalCapture:'unknown',highResolutionMaster:'unknown',originalTexture:'unknown',physicalDimensions:metadata?'recorded':'unknown',colorProfile:'unknown',captureDate:'unknown',captureDevice:'unknown',webAsset:files.some(f=>f.kind==='source'&&f.state==='verified'&&f.id===a.approved_asset_id&&assets.some(row=>row.id===f.id&&row.state==='stored'&&!row.deleted_at))?'verified':'unverified'},
   limits:{verifiedByteBudget:MAX_BYTES,olderRevisionsIncluded:revisions.length<=128,filesIncluded:assets.length<=MAX_FILES&&derivatives.length<=MAX_FILES,formatDecodingPerformed:false,backupOrIndependentRestoreVerified:false},
  };
 }
}
