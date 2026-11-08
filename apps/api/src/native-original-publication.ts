// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {revisionHash,type Exhibition} from '@exhibitos/spec';
import {ARTWORK_DETAIL_QUALITY_NAMESPACE,freezeCanonical,verifiedParsedDetailQuality,type DetailCandidate,type DetailFeatureReport} from '@exhibitos/studio-contract';
import {ApiError,type Session} from './auth.ts';
import {readApprovedOriginalStaticSource} from './artwork-original-static-approval.ts';
import {readBoundOriginalDetail} from './original-detail-binding.ts';
import {detailSourceCommitment,newDetailSourceNonce} from './detail-source-commitment.ts';
import {inspectJpegInOwnedWorker} from './jpeg-inspection-client.ts';
import {isIssuedNativeDetailContext,type NativeDetailContext} from './native-detail-context.ts';
import {hasQualifiedOriginalImageModel,qualifiedOriginalImageModel} from './native-original-image-model.ts';
import type {Studio} from './studio.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';

const unavailable=():never=>{throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');};
const issued=new WeakSet<object>();
type Grant=Awaited<ReturnType<typeof readApprovedOriginalStaticSource>>['grant'];
export type OriginalArtworkIdentity={artworkId:string;artworkRevisionId:string;artworkRevision:number;publicArtworkId:string;publicArtworkRevisionId:string};
type Prepared={client:PoolClient;xid:string;sessionId:string;exhibitionId:string;publicationId:string;snapshot:Exhibition;items:{artworkId:string;artworkRevision:number;publicArtworkId:string;publicArtworkRevisionId:string;importJobId:string;candidate:DetailCandidate;nonce:string;grant:Grant;modelInput:{sha256:string;bytes:number;width:number;height:number;iccSha256:string|null}}[]};
type Services={context:NativeDetailContext;studio:Studio;cms:Cms;imports:Imports;blobs:FileBlobStore};

/** Internal only: callers must hold an owned operation reservation and the
 * authenticated exclusive policy lock until completion, including on worker
 * cleanup uncertainty. No public route currently creates or uses this. */
export function createNativeOriginalPublication(services:Services){
 const {context,studio,cms,imports,blobs}=services,owner=context?.owner;
 if(!isIssuedNativeDetailContext(context)||!(blobs instanceof FileBlobStore)||!owner.matchesBlobRoot?.(blobs.root)||!imports.nativeWorkspace||imports.nativeWorkspace.workspaceId!==owner.workspaceId||imports.nativeWorkspace.tenantId!==owner.tenantId||imports.nativeWorkspace.principalId!==owner.principalId)throw Error('NATIVE_DETAIL_CONFIGURATION');
 const live=async(c:PoolClient,s:Session)=>{if(!context.live()||s.tenantId!==owner.tenantId||s.userId!==owner.principalId||!Number.isFinite(Date.parse(s.expiresAt))||Date.now()>=Date.parse(s.expiresAt))unavailable();await owner.assertDatabase(c);if(!context.live()||Date.now()>=Date.parse(s.expiresAt))unavailable();context.signal.throwIfAborted();};
 const pending=new WeakSet<object>(),persisted=new WeakSet<object>();
 const freeze=(v:unknown):void=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const item of Object.values(v))freeze(item);Object.freeze(v);}};
 const producer=Object.freeze({
  assertCurrent(s:Session){if(!context.live()||s.tenantId!==owner.tenantId||s.userId!==owner.principalId||!Number.isFinite(Date.parse(s.expiresAt))||Date.now()>=Date.parse(s.expiresAt))unavailable();context.signal.throwIfAborted();},
  async assertLive(c:PoolClient,s:Session){await live(c,s);},
  async verifyExisting(c:PoolClient,s:Session,exhibitionId:string,publicationId:string,revision:string,snapshot:Exhibition){
   await live(c,s);if((await c.query('SHOW transaction_isolation')).rows[0]?.transaction_isolation!=='read committed'||revisionHash(snapshot)!==revision)unavailable();
   const owned=(await c.query('SELECT 1 FROM exhibitions WHERE tenant_id=$1 AND id=$2 AND studio_owner_user_id=$3 AND deleted_at IS NULL',[s.tenantId,exhibitionId,s.userId])).rowCount;if(owned!==1)unavailable();
   let count=0,total=0;const ids=new Set<string>();for(const artwork of snapshot.artworks){const relation=artwork.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE];if(relation===undefined)continue;if(artwork.artworkType!=='image')unavailable();const verified=await verifiedParsedDetailQuality(relation,'image');if(!verified||verified.candidates.length!==1)return unavailable();const candidate=verified.candidates[0]!;if(candidate.tier!=='acquired-original'||candidate.featureReport.inspector!=='sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'||ids.has(candidate.assetId))unavailable();ids.add(candidate.assetId);count++;total+=candidate.bytes;if(count>16||!Number.isSafeInteger(total)||total>100*1024*1024)unavailable();
    const records=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'='native-original-detail-binding' AND metadata->>'publicationId'=$2 AND metadata->'candidate'->>'assetId'=$3 LIMIT 2",[s.tenantId,publicationId,candidate.assetId])).rows;if(records.length!==1)unavailable();const record=records[0].metadata as {artworkId:string;artworkRevision:number;importJobId:string};
    const source=await readBoundOriginalDetail(c,s,{workspaceId:owner.workspaceId,publicationId,revisionSha256:revision,exhibitionId,artworkId:record.artworkId,artworkRevision:record.artworkRevision,publicArtworkId:artwork.id,publicArtworkRevisionId:artwork.revisionId,importJobId:record.importJobId,candidate},studio,cms,imports,blobs,context.signal);try{if(!isDeepStrictEqual(qualifiedOriginalImageModel(source.modelInput),candidate.featureReport.cost))unavailable();}finally{source.bytes.fill(0);}
   }
   if(!count)throw new ApiError(409,'NATIVE_DETAIL_NEW_DRAFT_REQUIRED');await live(c,s);
  },
  async prepare(c:PoolClient,s:Session,exhibitionId:string,publicationId:string,snapshot:Exhibition,identities:OriginalArtworkIdentity[],reservedAssetIds:string[]):Promise<Prepared>{
   await live(c,s);if(!hasQualifiedOriginalImageModel()||(await c.query('SHOW transaction_isolation')).rows[0]?.transaction_isolation!=='read committed')unavailable();const xid=(await c.query('SELECT txid_current()::text AS xid')).rows[0].xid as string;
   const draft=structuredClone(snapshot),bindings=structuredClone(identities),reserved=new Set(reservedAssetIds.map(v=>v.toLowerCase())),revisions=bindings.map(a=>a.artworkRevisionId);if(new Set(revisions).size!==revisions.length||new Set(bindings.map(a=>a.artworkId)).size!==bindings.length||new Set(bindings.map(a=>a.publicArtworkId)).size!==bindings.length||new Set(bindings.map(a=>a.publicArtworkRevisionId)).size!==bindings.length||draft.artworks.some(a=>a.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE]!==undefined))unavailable();
   const found=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'='exact-original-static-grant' AND metadata->>'workspaceId'=$2 AND metadata->>'principalId'=$3 AND metadata->>'artworkRevisionId'=ANY($4::text[]) ORDER BY metadata->>'artworkRevisionId',id LIMIT 17",[s.tenantId,owner.workspaceId,s.userId,revisions])).rows;
   if(!found.length||found.length>16)unavailable();const items:Prepared['items']=[],seen=new Set<string>();let total=0;
   for(const row of found){context.signal.throwIfAborted();const g=row.metadata as Grant,identity=bindings.find(a=>a.artworkId===g?.artworkId&&a.artworkRevisionId===g?.artworkRevisionId&&a.artworkRevision===g?.artworkRevision),artwork=identity&&draft.artworks.find(a=>a.artworkType==='image'&&a.id===identity.publicArtworkId&&a.revisionId===identity.publicArtworkRevisionId&&a.revision===identity.artworkRevision);if(!identity||!artwork||seen.has(artwork.revisionId)||typeof g.jobId!=='string')return unavailable();seen.add(artwork.revisionId);
    const source=await readApprovedOriginalStaticSource(c,s,exhibitionId,{artworkId:identity.artworkId,artworkRevision:identity.artworkRevision,importJobId:g.jobId},studio,cms,imports,blobs,context.signal);let inspected:Awaited<ReturnType<typeof inspectJpegInOwnedWorker>>|undefined;
    try{if(!isDeepStrictEqual(g,source.grant))unavailable();inspected=await inspectJpegInOwnedWorker(source.bytes,context.signal);const receipt=inspected.receipt as {sourceSha256:string;sourceBytes:number;width:number;height:number;iccSha256:string|null;decoder:string};if(receipt.sourceSha256!==source.grant.source.sha256||receipt.sourceBytes!==source.grant.source.bytes||sha256(inspected.bytes)!==receipt.sourceSha256||receipt.decoder!=='sharp-0.35.4-vips-8.18.6-mozjpeg-0826579')unavailable();
     const modelInput={sha256:receipt.sourceSha256,bytes:receipt.sourceBytes,width:receipt.width,height:receipt.height,iccSha256:receipt.iccSha256},cost=qualifiedOriginalImageModel(modelInput);if(!cost)return unavailable();const featureReport:DetailFeatureReport={version:1,inspector:receipt.decoder,assetSha256:receipt.sourceSha256,assetBytes:receipt.sourceBytes,media:{kind:'image',codec:'jpeg',width:receipt.width,height:receipt.height,bitDepth:8,channels:3,frameCount:1,interlaced:false,orientation:1,colourProfile:receipt.iccSha256?'embedded-icc':'none'},cost},featureReportSha256=sha256(Buffer.from(freezeCanonical(featureReport))),candidateId=randomUUID(),assetId=randomUUID(),nonce=newDetailSourceNonce();
     if(reserved.has(assetId))unavailable();reserved.add(assetId);const candidate:DetailCandidate={candidateId,assetId,tier:'acquired-original',sha256:receipt.sourceSha256,bytes:receipt.sourceBytes,mime:'image/jpeg',featureReportSha256,featureReport,sourceBindingSha256:detailSourceCommitment({version:1,artworkRevisionId:identity.artworkRevisionId,candidateId,assetId,tier:'acquired-original',sha256:receipt.sourceSha256,bytes:receipt.sourceBytes,mime:'image/jpeg',featureReportSha256,rightsEvidenceSha256:source.grant.rightsEvidenceSha256,nonce})};
     if(!await verifiedParsedDetailQuality({version:1,candidates:[candidate]},'image'))unavailable();total+=candidate.bytes;if(!Number.isSafeInteger(total)||total>100*1024*1024)unavailable();artwork.extensions={...artwork.extensions,[ARTWORK_DETAIL_QUALITY_NAMESPACE]:{version:1,candidates:[candidate]}} as unknown as typeof artwork.extensions;items.push({artworkId:identity.artworkId,artworkRevision:identity.artworkRevision,publicArtworkId:identity.publicArtworkId,publicArtworkRevisionId:identity.publicArtworkRevisionId,importJobId:g.jobId,candidate,nonce,grant:source.grant,modelInput});
    }finally{source.bytes.fill(0);inspected?.bytes.fill(0);}
   }
   if(Buffer.byteLength(freezeCanonical(draft),'utf8')>1048576)unavailable();await live(c,s);freeze(draft);freeze(items);const prepared=Object.freeze({client:c,xid,sessionId:s.id,exhibitionId,publicationId,snapshot:draft,items});pending.add(prepared);return prepared;
  },
  async persist(c:PoolClient,s:Session,prepared:Prepared,revision:string){
   if(!pending.has(prepared))unavailable();pending.delete(prepared);await live(c,s);if(prepared.client!==c||prepared.sessionId!==s.id||(await c.query('SELECT txid_current()::text AS xid')).rows[0]?.xid!==prepared.xid||revisionHash(prepared.snapshot)!==revision)unavailable();
   const row=(await c.query("SELECT p.snapshot,p.revision_sha256 FROM studio_publications p JOIN publication_states st ON st.publication_id=p.id JOIN exhibitions e ON (e.tenant_id,e.id)=(p.tenant_id,p.exhibition_id) WHERE p.tenant_id=$1 AND p.id=$2 AND p.exhibition_id=$3 AND p.created_by=$4 AND e.studio_owner_user_id=$4 AND e.deleted_at IS NULL AND st.status='published'",[s.tenantId,prepared.publicationId,prepared.exhibitionId,s.userId])).rows[0];if(!row||row.revision_sha256!==revision||!isDeepStrictEqual(row.snapshot,prepared.snapshot))unavailable();
   for(const item of [...prepared.items].sort((a,b)=>a.candidate.assetId.localeCompare(b.candidate.assetId))){
    const matches=prepared.snapshot.artworks.filter(a=>a.id===item.publicArtworkId&&a.revisionId===item.publicArtworkRevisionId&&a.artworkType==='image');if(matches.length!==1||!isDeepStrictEqual(matches[0]!.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE],{version:1,candidates:[item.candidate]}))unavailable();
    const source=await readApprovedOriginalStaticSource(c,s,prepared.exhibitionId,{artworkId:item.artworkId,artworkRevision:item.artworkRevision,importJobId:item.importJobId},studio,cms,imports,blobs,context.signal);
    try{if(!isDeepStrictEqual(source.grant,item.grant)||sha256(source.bytes)!==item.candidate.sha256||!isDeepStrictEqual(qualifiedOriginalImageModel(item.modelInput),item.candidate.featureReport.cost))unavailable();}finally{source.bytes.fill(0);}
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`native-detail-binding:${s.tenantId}:${prepared.publicationId}:${item.candidate.assetId}`]);const duplicates=(await c.query("SELECT id FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'='native-original-detail-binding' AND metadata->>'publicationId'=$2 AND metadata->'candidate'->>'assetId'=$3 LIMIT 1",[s.tenantId,prepared.publicationId,item.candidate.assetId])).rows;if(duplicates.length)unavailable();
    const record={version:1,kind:'native-original-detail-binding',workspaceId:owner.workspaceId,tenantId:s.tenantId,principalId:s.userId,publicationId:prepared.publicationId,revisionSha256:revision,artworkId:item.artworkId,artworkRevision:item.artworkRevision,publicArtworkId:item.publicArtworkId,publicArtworkRevisionId:item.publicArtworkRevisionId,importJobId:item.importJobId,candidate:item.candidate,nonce:item.nonce,grant:item.grant,modelInput:item.modelInput};await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[s.tenantId,randomUUID(),item.grant.originalAssetId,record]);
   }
   await live(c,s);persisted.add(prepared);
  },
  async recheck(c:PoolClient,s:Session,prepared:Prepared,revision:string){
   if(!persisted.has(prepared)||prepared.client!==c||prepared.sessionId!==s.id||(await c.query('SELECT txid_current()::text AS xid')).rows[0]?.xid!==prepared.xid||revisionHash(prepared.snapshot)!==revision)unavailable();
   await live(c,s);for(const item of prepared.items){const source=await readBoundOriginalDetail(c,s,{workspaceId:owner.workspaceId,publicationId:prepared.publicationId,revisionSha256:revision,exhibitionId:prepared.exhibitionId,artworkId:item.artworkId,artworkRevision:item.artworkRevision,publicArtworkId:item.publicArtworkId,publicArtworkRevisionId:item.publicArtworkRevisionId,importJobId:item.importJobId,candidate:item.candidate},studio,cms,imports,blobs,context.signal);try{if(sha256(source.bytes)!==item.candidate.sha256||!isDeepStrictEqual(source.modelInput,item.modelInput)||!isDeepStrictEqual(qualifiedOriginalImageModel(source.modelInput),item.candidate.featureReport.cost))unavailable();}finally{source.bytes.fill(0);}}await live(c,s);
  },
 });issued.add(producer);return producer;
}
export type NativeOriginalPublication=ReturnType<typeof createNativeOriginalPublication>;
export const isIssuedNativeOriginalPublication=(value:unknown):value is NativeOriginalPublication=>!!value&&typeof value==='object'&&issued.has(value);
