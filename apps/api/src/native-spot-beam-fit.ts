// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import type {Exhibition} from '@exhibitos/spec';
import {
 lightDetailsFor, resolveSpotOpticalPose, solveSpotOpticalFit, spotArtworkOpticalBounds,
 spotBeamFitArtwork, spotOpticalAssetIds, spotOpticalFloors, type SpotOpticalMeasurement,
} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';
import type {Session} from './auth.ts';
import type {Cms} from './cms.ts';
import {COMPACT_MODEL_LIMITS, inspectCompactModelSource} from './oam-original-preparation.ts';
import {PRODUCT_IMAGE_LIMITS} from './product-image-preparation.ts';

export const NATIVE_SPOT_BEAM_FIT_PROFILE='saved-head-spot-beam-fit-v1';
export interface NativeSpotBeamFitIntent {placementId:string}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const unsupported=():never=>{throw new ApiError(422,'SPOT_BEAM_FIT_BOUNDS_UNSUPPORTED');};

export async function prepareNativeSpotBeamFit(c:PoolClient,s:Session,cms:Cms|undefined,document:Exhibition,lightId:string,intent:NativeSpotBeamFitIntent) {
 if(!cms)throw new ApiError(503,'NATIVE_OWNER_UNAVAILABLE');
 if(!intent||typeof intent!=='object'||Object.keys(intent).length!==1||typeof intent.placementId!=='string'
  ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.placementId))return unsupported();
 const light=document.lights.find(l=>same(l.id,lightId));
 if(!light)return unsupported();
 const details=lightDetailsFor(document).find(d=>same(d.lightId,lightId));
 let art:ReturnType<typeof spotBeamFitArtwork>;
 try{art=spotBeamFitArtwork(document,light,details,intent.placementId);}
 catch{return unsupported();}
 const verifyArtwork=async()=>{
  if(!isDeepStrictEqual((await cms.studioArtwork(c,s,art.id)).artwork,art))throw new ApiError(409,'ARTWORK_SNAPSHOT_CHANGED');
 };
 await verifyArtwork();
 const measurements:SpotOpticalMeasurement[]=[];
 for(const id of spotOpticalAssetIds(art)){
  const asset=art.assets.find(a=>same(a.id,id));
  if(!asset)return unsupported();
  const source=await cms.approvedVariantSource(c,s,art.id,asset.id,art.revision);
  if(source.sha256!==asset.sha256||source.bytes!==asset.bytes||source.mime!==asset.mime)throw new ApiError(409,'ASSET_INTEGRITY');
  if(source.mime==='image/png'){
   if(source.bytes<33||source.bytes>PRODUCT_IMAGE_LIMITS.outputBytes)return unsupported();
   const bytes=await source.read();
   if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.subarray(12,16).toString()!=='IHDR')return unsupported();
   measurements.push({kind:'png',assetId:asset.id,sha256:source.sha256,widthPx:bytes.readUInt32BE(16),heightPx:bytes.readUInt32BE(20)});
  }else if(source.mime==='model/gltf-binary'){
   if(source.bytes>COMPACT_MODEL_LIMITS.sourceBytes)return unsupported();
   const bytes=await source.read();
   try{
    const {bounds}=inspectCompactModelSource(bytes,{sha256:source.sha256,bytes:source.bytes});
    measurements.push({kind:'centered-glb',assetId:asset.id,sha256:source.sha256,size:[
     bounds.max[0]!-bounds.min[0]!,bounds.max[1]!-bounds.min[1]!,bounds.max[2]!-bounds.min[2]!,
    ]});
   }catch{return unsupported();}
  }else return unsupported();
 }
 await verifyArtwork();
 let fit:ReturnType<typeof solveSpotOpticalFit>;
 let bounds:ReturnType<typeof spotArtworkOpticalBounds>;
 try{
  const pose=resolveSpotOpticalPose(document,light,details);
  bounds=spotArtworkOpticalBounds(document,intent.placementId,measurements);
  fit=solveSpotOpticalFit({pose,bounds,floors:spotOpticalFloors(document,light.roomId)});
 }catch{return unsupported();}
 if(!fit.ok)throw new ApiError(422,'SPOT_BEAM_FIT_'+fit.reason.replaceAll('-','_').toUpperCase());
 const placement=document.placements.find(p=>same(p.id,intent.placementId))!;
 return {fullBeamRadians:fit.fullBeamRadians,beamFit:{placementId:placement.id,bounds:bounds[0]!.kind,...fit.evidence}};
}
