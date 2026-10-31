// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {entranceFor,LOD_NAMESPACE,validateViewerLod} from '@exhibitos/studio-contract';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {qualifyDemoDisplay} from './demo-display-policy.ts';
import {viewerVariants} from './viewer-variants.ts';

interface PublicBinding {id:string;sha256:string;bytes:number|string;mime:string;object_key:string}
interface Binding extends PublicBinding {source_sha256:string}
// Proof is a bounded performance cache, never an access grant. Any change to
// the existing PNG variant algorithm must bump this identifier.
const proofVersion=`viewer-png-box-v1:node-${process.versions.node}:zlib-${process.versions.zlib}`;
const proven=new Map<string,true>();
let activeProofs=0;
function pngSize(bytes:Buffer){
 if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw Error('COVER_PNG_INVALID');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>4096||height>4096||width*height>4194304)throw Error('COVER_PNG_INVALID');return {width,height};
}
/** The caller must authenticate the source, inventory and rights before and
 * after these reads. An archive descriptor alone is never such authority. */
export async function coverProjectionFromVerifiedSource(snapshot:Exhibition,revisionSha256:string,assets:PublicBinding[],blobs:Pick<BlobStore,'get'>){
 const selected=entranceFor(snapshot).imageAssetId?.toLowerCase();
 if(!selected)return undefined;
 const artwork=snapshot.artworks.find(a=>a.artworkType==='image'&&a.primaryAssetId.toLowerCase()===selected);
 if(!artwork||!validateViewerLod(artwork).valid)return undefined;
 const approval=qualifyDemoDisplay(artwork),coarse=approval?.coarse;
 const lod=artwork.extensions?.[LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string}[]}|undefined;
 const lowId=lod?.variants.find(v=>v.detail==='coarse')?.assetId;
 const primary=assets.find(a=>a.id.toLowerCase()===selected),low=assets.find(a=>a.id.toLowerCase()===lowId?.toLowerCase());
 if(!primary||!low||primary.mime!=='image/png'||low.mime!=='image/png'||!Number.isSafeInteger(Number(primary.bytes))||!Number.isSafeInteger(Number(low.bytes))||Number(primary.bytes)<33||Number(primary.bytes)>8388608||Number(low.bytes)<33||Number(low.bytes)>=Number(primary.bytes))return undefined;
 // Exact canonical artworks may use only their already-qualified pair. Never
 // rerun a transform against a canonical source as an optional proof.
 if(approval&&(!coarse||primary.sha256!==approval.canonicalAssetSha256||Number(primary.bytes)!==approval.canonicalBytes||low.sha256!==coarse.sha256||Number(low.bytes)!==coarse.bytes))return undefined;
 const fullRaw=await blobs.get(primary.object_key);
 if(fullRaw.length!==Number(primary.bytes))throw Error('COVER_ASSET_INTEGRITY');
 const fullBytes=Buffer.from(fullRaw);if(sha256(fullBytes)!==primary.sha256)throw Error('COVER_ASSET_INTEGRITY');
 const lowRaw=await blobs.get(low.object_key);
 if(lowRaw.length!==Number(low.bytes))throw Error('COVER_ASSET_INTEGRITY');
 const lowBytes=Buffer.from(lowRaw);if(sha256(lowBytes)!==low.sha256)throw Error('COVER_ASSET_INTEGRITY');
 const fullSize=pngSize(fullBytes),lowSize=pngSize(lowBytes);
 if(coarse){if(lowSize.width!==coarse.width||lowSize.height!==coarse.height)throw Error('COVER_ASSET_INTEGRITY');}
 else {
  // An imported LOD declaration is not evidence. Reproduce the existing
  // server transform and require exact bytes, then cache only this proof.
  const key=`${primary.sha256}:${low.sha256}:${proofVersion}`;
  if(!proven.has(key)){
   if(activeProofs>=1)return undefined;
   activeProofs++;
   try{const result=await viewerVariants(fullBytes,'image/png');if(!result.bytes||!result.bytes.equals(lowBytes))return undefined;}
   finally{activeProofs--;}
   if(proven.size>=32)proven.delete(proven.keys().next().value!);
   proven.set(key,true);
  }
 }
 return {version:1 as const,revisionSha256,primary:{assetId:primary.id,mime:'image/png' as const,sha256:primary.sha256,bytes:Number(primary.bytes),...fullSize},variants:[{assetId:low.id,mime:'image/png' as const,sha256:low.sha256,bytes:Number(low.bytes),...lowSize}]};
}
/** Server rows must already pass the live publication gate. Exact canonical
 * pairs additionally retain their original-source binding; the caller repeats
 * the full gate after asynchronous reads, including on optional failure. */
export async function approvedCoverProjection(snapshot:Exhibition,revisionSha256:string,assets:Binding[],blobs:BlobStore){
 const selected=entranceFor(snapshot).imageAssetId?.toLowerCase();
 const artwork=snapshot.artworks.find(a=>a.artworkType==='image'&&a.primaryAssetId.toLowerCase()===selected);
 if(!artwork)return undefined;
 const approval=qualifyDemoDisplay(artwork);
 if(approval){
  const lowId=(artwork.extensions?.[LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string}[]}|undefined)?.variants.find(v=>v.detail==='coarse')?.assetId;
  const primary=assets.find(a=>a.id.toLowerCase()===selected),low=assets.find(a=>a.id.toLowerCase()===lowId?.toLowerCase());
  if(!approval.coarse||!primary||!low||primary.source_sha256!==approval.canonicalAssetSha256||low.source_sha256!==approval.coarse.sha256)return undefined;
 }
 return coverProjectionFromVerifiedSource(snapshot,revisionSha256,assets,blobs);
}
