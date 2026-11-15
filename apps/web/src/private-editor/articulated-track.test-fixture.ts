// SPDX-License-Identifier: AGPL-3.0-or-later
import {ARTICULATED_TRACK_SPOT_IDENTITY,WORKSPACE_FURNISHING_NAMESPACE,ceilingRailAttachmentMatrix,ceilingRailDerivedPose,type TrackSpotAimBinding,type WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {paintingWasherCandidate,lightId,assetId} from '../../../../packages/studio-contract/test-fixtures/wallwasher';

/** Synthetic unit-scale straight rail. Model fixtures are supplied by each
 * consumer test; this function grants no real catalogue/asset authority. */
export function articulatedTrackFixture(){
 const document=paintingWasherCandidate().moved,room=document.rooms[0]!,surface=document.surfaces[0]!;
 room.dimensions.width=12;room.dimensions.depth=12;surface.dimensions={width:12,height:12};
 const railId='b0000000-0000-4000-8000-000000000001',railPlacementId='b0000000-0000-4000-8000-000000000002';
 const sha256='f'.repeat(64),descriptor={id:railId,version:1,kind:'ceiling-rail',name:'Synthetic straight rail',provenance:'Synthetic test geometry',rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},model:{mime:'model/gltf-binary',sha256,bytes:1024},fit:{version:1,sourceSha256:sha256,sourceBytes:1024,geometry:{profile:'passive-ceiling-rail-v1',min:[-3,-.035,-.02],max:[3,0,.02]}}} satisfies WorkspaceFurnishingDescriptor;
 const attachment={placementId:railPlacementId,surfaceId:surface.id,anchor:[0,0] as [number,number],yaw:0,gap:0};
 document.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[descriptor],placements:[{id:railPlacementId,roomId:room.id,furnishingId:railId,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const binding:TrackSpotAimBinding={version:1,profile:'track-spot-aim-v1',mount:{railPlacementId,position:[-1,-.035,0],yaw:0},aim:{kind:'point',position:[-1,1.5,-1.2]}};
 const trackAim={...binding};
 document.extensions!['org.exhibitos.studio/light-details']={version:1,lights:[{lightId,fixture:'none',trackAim,range:7,penumbra:.35}]};
 delete document.extensions!['org.exhibitos.studio/light-attachments'];
 document.extensions!['org.exhibitos.studio/furnishing-visuals']={version:1,assets:[{...ARTICULATED_TRACK_SPOT_IDENTITY,id:assetId}],bindings:[{hostKind:'light',hostId:lightId,assetId,pose:{position:[0,.15,.0755],yaw:0,scale:1}}]};
 return {document,binding:trackAim,lightId,assetId,descriptor,railPlacementId};
}
