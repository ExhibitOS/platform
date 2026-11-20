// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import type {Exhibition} from '@exhibitos/spec';
import {freezeCanonical,validateWorkspaceFurnishings,WHEAT_FRAME_ID,WHEAT_FRAME_MODEL_SHA256,WHEAT_SELECTED_SCOPE,WHEAT_STOCK_NOTICE,
 WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {ApiError,type Session} from './auth.ts';
import {readInstalledFurnishing} from './furnishing-assets.ts';
import {installedFurnishingCatalogueFile,installedFurnishingDescriptorFor,readInstalledFurnishingModel} from './installed-workspace-furnishing.ts';
import type {NativeDetailContext} from './native-detail-context.ts';
import {nativeFrameImageFitProposal} from './native-frame-image-fit.ts';

export const ACCEPTED_PUBLIC_WHEAT_MANIFEST='c7cabff5919304e57b78f2babc16b207817392c1ecb82428f4a5a62fa4ef2534';
const acceptedWheatScene='1f103fe942c434d526de2e88ec35f2967a4c0bc53f1ebaa0d639b5fddb5b4658';
const placementId='89ec602d-79ff-4851-9ead-85bdd4a382cf';
const exactImageFit={
 version:1,profile:'contain-contact-v1',
 sourceSha256:'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7',
 pixelWidth:2048,pixelHeight:1630,
} as const;

type WheatHead = Extract<NonNullable<NativeDetailContext['selectedHead']>,{scope:typeof WHEAT_SELECTED_SCOPE}>;
type Predecessor = Pick<WheatHead,'predecessorPublicationId'|'predecessorRevisionSha256'|'revision'|'etag'>;
const unavailable=():never=>{throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');};
const furnishings=(scene:Exhibition)=>scene.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined;

/** Verify the one actual saved attachment delta before replaying it on the
 * historical public projection, which contains no subsequent Painting bench. */
export function projectSelectedWheatImageFit(selected:Exhibition,before:Exhibition,saved:Exhibition):Exhibition{
 if(createHash('sha256').update(freezeCanonical(selected)).digest('hex')!==acceptedWheatScene)return unavailable();
 const command={type:'reconcile-frame-image-fit',placementId} as const;
 try{
  const expected=nativeFrameImageFitProposal(before,command,exactImageFit).candidate;
  if(!isDeepStrictEqual(expected,saved))return unavailable();
  return nativeFrameImageFitProposal(selected,command,exactImageFit).candidate;
 }catch{return unavailable();}
}

export async function assertAcceptedSelectedPredecessor(c:PoolClient,s:Session,exhibitionId:string,head:Predecessor,
 selection:string,projectionIdentity:string,scope?:typeof WHEAT_SELECTED_SCOPE){
 const scopeClause=scope===undefined?'':" AND r.response->>'scope'=$10";
 const row=(await c.query(`SELECT 1 FROM studio_publications p
  JOIN publication_states st ON st.publication_id=p.id AND st.status='published'
  JOIN studio_requests r ON (r.tenant_id,r.user_id,r.exhibition_id)=(p.tenant_id,p.created_by,p.exhibition_id)
  WHERE p.tenant_id=$1 AND p.created_by=$2 AND p.exhibition_id=$3 AND p.id=$4 AND p.revision_sha256=$5
   AND p.draft_revision=$6 AND r.response->>'publicationId'=p.id::text AND r.response->>'head'=$7
   AND r.response->>'releaseSelection'=$8 AND r.response->>'projectionIdentity'=$9${scopeClause}`,
 [s.tenantId,s.userId,exhibitionId,head.predecessorPublicationId,head.predecessorRevisionSha256,head.revision,head.etag,selection,projectionIdentity,
  ...(scope===undefined?[]:[scope])])).rows[0];
 if(!row)return unavailable();
}

export async function readSelectedWheatNotice(){
 const descriptor=installedFurnishingDescriptorFor(WHEAT_FRAME_ID);
 const stock=descriptor&&installedFurnishingCatalogueFile(descriptor)?.notice;
 if(!stock||stock.sha256!==WHEAT_STOCK_NOTICE.sha256||stock.bytes!==WHEAT_STOCK_NOTICE.bytes)return unavailable();
 const bytes=await readInstalledFurnishing(stock.path,stock.bytes,stock.sha256,undefined,true);
 if(!bytes)return unavailable();
 return bytes;
}

export async function projectSelectedWheatFrame(selected:Exhibition,before:Exhibition,saved:Exhibition):Promise<Exhibition>{
 const source=furnishings(saved),prior=furnishings(before),selectedFurnishings=furnishings(selected);
 if(source?.version!==11||prior?.version!==11||selectedFurnishings?.version!==11||
  !source.frameAttachments||!prior.frameAttachments||!selectedFurnishings.frameAttachments)return unavailable();
 const descriptor=source.furnishings.at(-1),attachment=source.frameAttachments.at(-1);
 const approved=installedFurnishingDescriptorFor(WHEAT_FRAME_ID);
 if(!descriptor||!attachment||!approved||!isDeepStrictEqual(descriptor,approved)||
  !isDeepStrictEqual(attachment,{placementId,artworkRevisionId:'53d66af3-0ff2-4dd9-8cc7-9056a6ddf8b9',
   assetId:'000266b5-34b5-44c2-a794-1fe8c344f949',furnishingId:WHEAT_FRAME_ID,furnishingVersion:1,modelSha256:WHEAT_FRAME_MODEL_SHA256}))
  return unavailable();
 const expected=structuredClone(before);
 furnishings(expected)!.furnishings.push(descriptor);
 furnishings(expected)!.frameAttachments!.push(attachment);
 if(!isDeepStrictEqual(expected,saved)||selectedFurnishings.furnishings.some(row=>row.id===WHEAT_FRAME_ID)||
  selectedFurnishings.frameAttachments.some(row=>row.placementId===attachment.placementId))return unavailable();

 const next=structuredClone(selected);
 furnishings(next)!.furnishings.push(structuredClone(descriptor));
 furnishings(next)!.frameAttachments!.push(structuredClone(attachment));
 if(!validateWorkspaceFurnishings(next).valid)return unavailable();
 const model=await readInstalledFurnishingModel(WHEAT_FRAME_ID);
 if(!model||model.sha256!==descriptor.model.sha256||model.bytes.length!==descriptor.model.bytes||model.mime!==descriptor.model.mime)
  return unavailable();
 await readSelectedWheatNotice();
 return next;
}
