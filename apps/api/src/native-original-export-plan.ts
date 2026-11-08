// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {revisionHash,type Exhibition} from '@exhibitos/spec';
import {ARTWORK_DETAIL_QUALITY_NAMESPACE,freezeCanonical,furnishingsFor,verifiedParsedDetailQuality,type DetailCandidate} from '@exhibitos/studio-contract';
import {ApiError,type Session} from './auth.ts';
import {isIssuedNativeDetailContext,type NativeDetailContext} from './native-detail-context.ts';
import {hasQualifiedOriginalImageModel,qualifiedOriginalImageModel} from './native-original-image-model.ts';
import {readBoundOriginalDetail} from './original-detail-binding.ts';
import type {Studio} from './studio.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';

const unavailable=():never=>{throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');};
type Dependencies={context:NativeDetailContext;studio:Studio;cms:Cms;imports:Imports;blobs:FileBlobStore};
type Tuple={assetId:string;sourceBindingSha256:string;sha256:string;bytes:number;mime:string;featureReportSha256:string};
type Selected={assetId:string;sourceBindingSha256:string};

/** Reconstruct the committed public candidate set and privately verify its
 * complete source bindings, or return one exact bound byte snapshot. Caller
 * holds the authenticated READ COMMITTED shared policy/owner transaction and
 * an owned operation reservation through response cleanup. */
export async function reconstructNativeOriginalExport(c:PoolClient,s:Session,publicationId:string,revision:string,deps:Dependencies,signal:AbortSignal,selected?:Selected){
 s={...s};if(selected)selected={...selected};
 const {context,studio,cms,imports,blobs}=deps,owner=context?.owner;if(!isIssuedNativeDetailContext(context)||!(blobs instanceof FileBlobStore)||!owner.matchesBlobRoot?.(blobs.root)||!imports.nativeWorkspace||imports.nativeWorkspace.workspaceId!==owner.workspaceId||imports.nativeWorkspace.tenantId!==owner.tenantId||imports.nativeWorkspace.principalId!==owner.principalId)unavailable();
 const live=async()=>{signal.throwIfAborted();if(!context.live()||s.tenantId!==owner.tenantId||s.userId!==owner.principalId||!Number.isFinite(Date.parse(s.expiresAt))||Date.now()>=Date.parse(s.expiresAt))unavailable();await owner.assertDatabase(c);signal.throwIfAborted();if(!context.live()||Date.now()>=Date.parse(s.expiresAt))unavailable();};
 await live();if((await c.query('SHOW transaction_isolation')).rows[0]?.transaction_isolation!=='read committed')unavailable();
 const row=(await c.query("SELECT p.exhibition_id,p.snapshot,p.revision_sha256,st.status,e.studio_owner_user_id FROM studio_publications p JOIN publication_states st ON st.publication_id=p.id JOIN exhibitions e ON (e.tenant_id,e.id)=(p.tenant_id,p.exhibition_id) WHERE p.tenant_id=$1 AND p.id=$2 AND e.deleted_at IS NULL",[s.tenantId,publicationId])).rows[0] as {exhibition_id:string;snapshot:Exhibition;revision_sha256:string;status:string;studio_owner_user_id:string}|undefined;
 if(!row||row.status!=='published'||row.studio_owner_user_id!==s.userId||row.revision_sha256!==revision||revisionHash(row.snapshot)!==revision||!Array.isArray(row.snapshot.artworks))return unavailable();
 const normal=(await c.query('SELECT id FROM publication_assets WHERE tenant_id=$1 AND publication_id=$2 UNION ALL SELECT id FROM publication_media WHERE tenant_id=$1 AND publication_id=$2 UNION ALL SELECT id FROM publication_cover_images WHERE tenant_id=$1 AND publication_id=$2 UNION ALL SELECT public_id AS id FROM publication_workspace_materials WHERE tenant_id=$1 AND publication_id=$2 UNION ALL SELECT public_id AS id FROM publication_workspace_furnishings WHERE tenant_id=$1 AND publication_id=$2',[s.tenantId,publicationId])).rows;
 const occupied=new Set([...normal.map(r=>String(r.id).toLowerCase()),...(furnishingsFor(row.snapshot)?.assets??[]).map(a=>a.id.toLowerCase())]),candidateIds=new Set<string>(),candidates:Array<{artworkId:string;artworkRevisionId:string;candidate:DetailCandidate}>=[];let total=0;
 for(const artwork of row.snapshot.artworks){const relation=artwork.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE];if(relation===undefined)continue;if(artwork.artworkType!=='image')unavailable();const parsed=await verifiedParsedDetailQuality(relation,'image');if(!parsed||parsed.candidates.length!==1)return unavailable();const candidate=parsed.candidates[0]!;if(candidate.tier!=='acquired-original'||candidate.featureReport.inspector!=='sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'||occupied.has(candidate.assetId)||candidateIds.has(candidate.candidateId)||candidate.bytes>25*1024*1024)unavailable();occupied.add(candidate.assetId);candidateIds.add(candidate.candidateId);total+=candidate.bytes;if(candidates.length>=16||!Number.isSafeInteger(total)||total>100*1024*1024)unavailable();candidates.push({artworkId:artwork.id,artworkRevisionId:artwork.revisionId,candidate});}
 if(candidates.length&&!hasQualifiedOriginalImageModel())unavailable();if(selected&&(!candidates.some(x=>x.candidate.assetId===selected.assetId&&x.candidate.sourceBindingSha256===selected.sourceBindingSha256)))unavailable();
 const tuples:Tuple[]=candidates.map(({candidate})=>({assetId:candidate.assetId,sourceBindingSha256:candidate.sourceBindingSha256,sha256:candidate.sha256,bytes:candidate.bytes,mime:candidate.mime,featureReportSha256:candidate.featureReportSha256})).sort((a,b)=>a.assetId<b.assetId?-1:a.assetId>b.assetId?1:0);
 let retained:Buffer|undefined,handed=false;try{
  for(const item of candidates){if(selected&&item.candidate.assetId!==selected.assetId)continue;signal.throwIfAborted();const rows=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'='native-original-detail-binding' AND metadata->>'publicationId'=$2 AND metadata->'candidate'->>'assetId'=$3 LIMIT 2",[s.tenantId,publicationId,item.candidate.assetId])).rows;if(rows.length!==1)unavailable();const record=rows[0].metadata as {artworkId:string;artworkRevision:number;importJobId:string};
   const source=await readBoundOriginalDetail(c,s,{workspaceId:owner.workspaceId,publicationId,revisionSha256:revision,exhibitionId:row.exhibition_id,artworkId:record.artworkId,artworkRevision:record.artworkRevision,publicArtworkId:item.artworkId,publicArtworkRevisionId:item.artworkRevisionId,importJobId:record.importJobId,candidate:item.candidate},studio,cms,imports,blobs,signal);
   try{const cost=qualifiedOriginalImageModel(source.modelInput);if(!cost||freezeCanonical(cost)!==freezeCanonical(item.candidate.featureReport.cost))unavailable();if(selected){retained=source.bytes;continue;}}finally{if(source.bytes!==retained)source.bytes.fill(0);}
  }
  await live();if(selected&&!retained)unavailable();const detailSetSha256=createHash('sha256').update(freezeCanonical(tuples),'utf8').digest('hex'),descriptors=tuples.map(tuple=>({assetId:tuple.assetId,url:`/api/v1/publications/${publicationId}/detail-assets/${tuple.assetId}`,mime:tuple.mime}));handed=true;return {tuples,detailSetSha256,descriptors,...(retained?{bytes:retained}:{})};
 }finally{if(!handed)retained?.fill(0);}
}
