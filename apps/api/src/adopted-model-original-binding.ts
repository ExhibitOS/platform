// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import type {Artwork} from '@exhibitos/spec';
import {ARTWORK_DETAIL_QUALITY_NAMESPACE,freezeCanonical,verifiedParsedDetailQuality,type DetailCandidate} from '@exhibitos/studio-contract';
import {ApiError,type Session} from './auth.ts';
import {adoptedModelOriginalGrantKind,readApprovedAdoptedModelOriginal,type AdoptedModelOriginalApproval} from './adopted-model-original-approval.ts';
import type {Cms} from './cms.ts';
import {detailSourceCommitment,newDetailSourceNonce} from './detail-source-commitment.ts';
import type {Imports} from './imports.ts';
import type {OriginalArtworkIdentity} from './native-original-publication.ts';
import type {Studio} from './studio.ts';

const kind='native-adopted-model-detail-binding';
const unavailable=():never=>{throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');};
type Dependencies={studio:Studio;cms:Cms;imports:Imports;blobs:BlobStore};
type Scope={workspaceId:string;exhibitionId:string;publicationId:string};
type AdoptedSource=Awaited<ReturnType<typeof readApprovedAdoptedModelOriginal>>;
type ModelItem={input:AdoptedModelOriginalApproval;publicArtworkId:string;publicArtworkRevisionId:string;candidate:DetailCandidate;nonce:string;grant:AdoptedSource['grant']};

export async function hasAdoptedModelOriginalApproval(c:PoolClient,s:Session,workspaceId:string,exhibitionId:string){
 return (await c.query(`SELECT 1 FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'=$2
   AND metadata->>'workspaceId'=$3 AND metadata->>'principalId'=$4 AND metadata->>'exhibitionId'=$5 LIMIT 1`,
  [s.tenantId,adoptedModelOriginalGrantKind,workspaceId,s.userId,exhibitionId])).rowCount===1;
}

const readSource=(c:PoolClient,s:Session,scope:Scope,input:AdoptedModelOriginalApproval,deps:Dependencies,signal:AbortSignal)=>
 readApprovedAdoptedModelOriginal(c,s,scope.exhibitionId,input,deps.studio,deps.cms,deps.imports,deps.blobs,signal);

function bindingDigest(artworkRevisionId:string,candidate:DetailCandidate,grant:AdoptedSource['grant'],nonce:string){
 const {candidateId,assetId,tier,sha256,bytes,mime,featureReportSha256}=candidate;
 return detailSourceCommitment({version:1,artworkRevisionId,candidateId,assetId,tier,sha256,bytes,mime,featureReportSha256,
  rightsEvidenceSha256:grant.sourceRightsSha256,nonce});
}

export async function prepareAdoptedModelOriginals(c:PoolClient,s:Session,scope:Scope,artworks:Artwork[],identities:OriginalArtworkIdentity[],reserved:Set<string>,deps:Dependencies,signal:AbortSignal){
 const models=identities.filter(identity=>artworks.some(artwork=>artwork.artworkType==='sculpture'&&artwork.revisionId===identity.publicArtworkRevisionId));
 const grants=(await c.query(`SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'=$2
   AND metadata->>'workspaceId'=$3 AND metadata->>'principalId'=$4 AND metadata->>'exhibitionId'=$5
   AND metadata->>'artworkRevisionId'=ANY($6::text[]) ORDER BY id LIMIT 17`,
  [s.tenantId,adoptedModelOriginalGrantKind,scope.workspaceId,s.userId,scope.exhibitionId,models.map(model=>model.artworkRevisionId)])).rows;
 const items:ModelItem[]=[];
 const seen=new Set<string>();
 for(const row of grants){
  const input=row.metadata?.input as AdoptedModelOriginalApproval;
  const identity=models.find(model=>model.artworkId===input?.artworkId&&model.artworkRevision===input?.artworkRevision&&model.artworkRevisionId===row.metadata?.artworkRevisionId);
  const artwork=identity&&artworks.find(item=>item.id===identity.publicArtworkId&&item.revisionId===identity.publicArtworkRevisionId);
  if(!identity||!artwork||seen.has(artwork.revisionId)||grants.length>16)return unavailable();
  seen.add(artwork.revisionId);
  const {grant,bytes}=await readSource(c,s,scope,input,deps,signal);
  try{
   const display=artwork.assets.find(asset=>asset.id===artwork.primaryAssetId);
   if(!isDeepStrictEqual(grant,row.metadata)||display?.sha256!==grant.display.sha256||display.bytes!==grant.display.bytes)return unavailable();
   const assetId=randomUUID(),candidateId=randomUUID(),nonce=newDetailSourceNonce();
   if(reserved.has(assetId))return unavailable();
   reserved.add(assetId);
   const featureReport=grant.featureReport,featureReportSha256=sha256(Buffer.from(freezeCanonical(featureReport)));
   const candidate:DetailCandidate={candidateId,assetId,tier:'acquired-original',sha256:grant.original.sha256,bytes:grant.original.bytes,
    mime:'model/gltf-binary',featureReportSha256,featureReport,sourceBindingSha256:''};
   candidate.sourceBindingSha256=bindingDigest(identity.artworkRevisionId,candidate,grant,nonce);
   const relation={version:1,candidates:[candidate]};
   if(!await verifiedParsedDetailQuality(relation,'sculpture'))return unavailable();
   artwork.extensions={...artwork.extensions,[ARTWORK_DETAIL_QUALITY_NAMESPACE]:relation} as unknown as Artwork['extensions'];
   items.push({input,publicArtworkId:artwork.id,publicArtworkRevisionId:artwork.revisionId,candidate,nonce,grant});
  }finally{bytes.fill(0);}
 }
 return items;
}

export async function persistAdoptedModelOriginal(c:PoolClient,s:Session,scope:Scope,revisionSha256:string,item:ModelItem,deps:Dependencies,signal:AbortSignal){
 const {grant,bytes}=await readSource(c,s,scope,item.input,deps,signal);
 try{
  if(!isDeepStrictEqual(grant,item.grant))return unavailable();
  const metadata={version:1,kind,...scope,revisionSha256,...item};
  await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',
   [s.tenantId,randomUUID(),grant.originalAssetId,metadata]);
 }finally{bytes.fill(0);}
}

export async function readBoundAdoptedModelOriginal(c:PoolClient,s:Session,scope:Scope,revisionSha256:string,publicArtworkId:string,
 publicArtworkRevisionId:string,candidate:DetailCandidate,deps:Dependencies,signal:AbortSignal){
 const rows=(await c.query(`SELECT asset_id,metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL
  AND metadata->>'kind'=$2 AND metadata->>'publicationId'=$3 AND metadata->'candidate'->>'assetId'=$4 LIMIT 2 FOR SHARE`,
 [s.tenantId,kind,scope.publicationId,candidate.assetId])).rows;
 const item=rows[0]?.metadata as ModelItem&Scope&{version:number;kind:string;revisionSha256:string};
 if(rows.length!==1||!item||item.version!==1||item.kind!==kind||item.workspaceId!==scope.workspaceId||
  item.exhibitionId!==scope.exhibitionId||item.publicationId!==scope.publicationId||item.revisionSha256!==revisionSha256||
  item.publicArtworkId!==publicArtworkId||item.publicArtworkRevisionId!==publicArtworkRevisionId||
  !isDeepStrictEqual(item.candidate,candidate)||rows[0].asset_id!==item.grant?.originalAssetId)return unavailable();
 const {grant,bytes}=await readSource(c,s,scope,item.input,deps,signal);
 let returned=false;
 try{
  if(!isDeepStrictEqual(grant,item.grant)||!isDeepStrictEqual(grant.featureReport,candidate.featureReport)||
   bindingDigest(grant.artworkRevisionId,candidate,grant,item.nonce)!==candidate.sourceBindingSha256)return unavailable();
  returned=true;
  return bytes;
 }finally{if(!returned)bytes.fill(0);}
}
