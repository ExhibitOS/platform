// SPDX-License-Identifier: AGPL-3.0-or-later
import {paintingWasherCandidate,lightId,assetId} from './wallwasher.js';
import {syntheticArtwork,newPlacement} from '../../../apps/web/src/placement/model.js';
import {WORKSPACE_FURNISHING_NAMESPACE,ceilingRailAttachmentMatrix,ceilingRailDerivedPose,type WorkspaceFurnishingDescriptor} from '../src/workspace-furnishing.js';
import {applyLightObjectCommand} from '../src/light-object.js';
import type {TrackSpotAimBinding} from '../src/track-spot-aim-binding.js';
export {lightId,assetId};
export function articulatedTrackSpotCandidate(){
 const base=paintingWasherCandidate().moved,room=base.rooms[0]!,surface=base.surfaces[0]!,railId='b0000000-0000-4000-8000-000000000001',pid='b0000000-0000-4000-8000-000000000002';
 room.dimensions.width=12;room.dimensions.depth=12;surface.dimensions={width:12,height:12};
 const sha='aca126489bf21adcc637e9a3c3bb805bb57f93111c3333a8fdefab9d371d1c42',descriptor:WorkspaceFurnishingDescriptor={id:railId,version:1,kind:'ceiling-rail',name:'Rectangle',provenance:'Redistributable authored source',rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},model:{mime:'model/gltf-binary',sha256:sha,bytes:268820},fit:{version:1,sourceSha256:sha,sourceBytes:268820,geometry:{profile:'passive-ceiling-rail-v1',min:[-2.809499979019165,-.03500000014901161,-3.809499979019165],max:[2.809499979019165,0,3.809499979019165]}}};
 const attachment={placementId:pid,surfaceId:surface.id,anchor:[0,0] as [number,number],yaw:0,gap:0};
 base.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[descriptor],placements:[{id:pid,roomId:room.id,furnishingId:railId,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const artwork=syntheticArtwork(),placement=newPlacement(artwork,room.id);
 artwork.transform={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};placement.roomId=room.id;placement.artworkRevisionId=artwork.revisionId;placement.transform={position:[-2.2,1.5,-4.8],rotation:[0,0,0,1],scale:[1,1,1]};base.artworks=[artwork];base.placements=[placement];base.accessibility.artworkDescriptions=[{placementId:placement.id,text:'Synthetic aim target'}];
 const trackAim:TrackSpotAimBinding={version:1,profile:'track-spot-aim-v1',mount:{railPlacementId:pid,position:[-2.2,-.035,-3.79],yaw:0},aim:{kind:'placement-center',placementId:placement.id,offset:[0,0,0]}};
 const command={type:'set-light-fixture' as const,lightId,visual:{catalogId:'museum-track-spot-articulated' as const,catalogVersion:1 as const,pose:{position:[0,.15,.0755] as [number,number,number],yaw:0,scale:1},trackAim}};
 const candidate=applyLightObjectCommand(base,command,{newAssetId:assetId,verifiedBaseline:base}).candidate;
 return {base,candidate,command,trackAim,placementId:placement.id,railPlacementId:pid};
}
