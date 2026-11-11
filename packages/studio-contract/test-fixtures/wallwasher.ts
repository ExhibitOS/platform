// SPDX-License-Identifier: AGPL-3.0-or-later
import {newDraft} from '../../../apps/web/src/drafts/example.js';
import {applyLightObjectCommand} from '../src/light-object.js';
import {lightAttachmentPose} from '../src/room-envelope.js';

export const lightId='a0000000-0000-4000-8000-000000000001',assetId='a0000000-0000-4000-8000-000000000002';
export const emitter:[number,number,number]=[-2.457939962346657,3.8619541213603323,2.5];
export function paintingWasherCandidate(){
 const base=newDraft('Painting washer source qualification').candidate,room=base.rooms[0]!,q=Math.SQRT1_2;
 room.transform.position=[0,0,-7];
 const ceiling={id:'a0000000-0000-4000-8000-000000000003',roomId:room.id,type:'ceiling' as const,dimensions:{width:room.dimensions.width,height:room.dimensions.depth},transform:{position:[0,4,0] as [number,number,number],rotation:[q,0,0,q] as [number,number,number,number],scale:[1,1,1] as [number,number,number]}};
 base.surfaces=[ceiling];base.placements=[];base.artworks=[];base.mediaAssets=[];
 base.lights=[{id:lightId,roomId:room.id,type:'spot',transform:{position:[0,3.8,0],rotation:[0,0,0,1],scale:[1,1,1]},color:[1,.8,.6],intensity:80,unit:'candela',castsShadow:false,beamAngle:.5}];
 const attachment={surfaceId:ceiling.id,anchor:[emitter[0],emitter[2]] as [number,number],gap:4-emitter[1]},pose=lightAttachmentPose(ceiling,{...attachment,lightId});
 const {id:_,...fields}=base.lights[0]!;void _;
 const moved=applyLightObjectCommand(base,{type:'set-light-object',lightId,light:{...fields,transform:pose},settings:{fixture:'none',aim:{kind:'point',position:[-3.94,1.5,2.5]}},attachment}).candidate;
 const candidate=applyLightObjectCommand(moved,{type:'set-light-fixture',lightId,visual:{catalogId:'museum-wallwasher-rear-relief',catalogVersion:1,pose:{position:[0,.106,.05],yaw:0,scale:1}}},{newAssetId:assetId}).candidate;
 return {base,moved,candidate};
}
