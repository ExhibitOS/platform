// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {validateCeilingRailAttachments} from '@exhibitos/spec/ceiling-rail';
import {ceilingRailAttachmentMatrix,ceilingRailDerivedPose,validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE as W} from './workspace-furnishing.js';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const room={id:id(1),dimensions:{width:8,height:4,depth:10},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}};
 const surface={id:id(2),roomId:room.id,type:'ceiling',dimensions:{width:8,height:10},transform:{position:[0,4,0],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}};
 const attachment={placementId:id(4),surfaceId:surface.id,anchor:[-2.2,-2.402],yaw:0,gap:0};
 const model={mime:'model/gltf-binary',bytes:100,sha256:'a'.repeat(64)};
 const descriptor={id:id(3),version:1,kind:'ceiling-rail',name:'Synthetic measured rail',rights:{},provenance:'Synthetic test geometry',model,
  fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}}};
 const placement={id:id(4),roomId:room.id,furnishingId:descriptor.id,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)};
 const extension={version:11,furnishings:[descriptor],placements:[placement],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const candidate={rooms:[room],surfaces:[surface],extensions:{[W]:extension}};
 return {candidate,room,surface,attachment,descriptor,placement,extension};
}

it('uses the existing measured ceiling contract for derived rail contact roundoff',()=>{
 const {candidate,room,extension,placement}=fixture();
 // This exact finite rotation produces the real one-ulp contact excess without hand-editing the derived pose.
 expect(placement.position[1]).toBe(4.000000000000001);
 expect(placement.position[1]).toBeGreaterThan(room.dimensions.height);
 expect(validateCeilingRailAttachments(extension,candidate)).toEqual([]);
 expect(validateWorkspaceFurnishings(candidate)).toEqual({valid:true,errors:[]});
});

it('still rejects unmatched poses, actual footprint overflow, missing attachments and unqualified rail sources',()=>{
 const pose=fixture();pose.placement.position[1]!+=.0001;
 expect(validateWorkspaceFurnishings(pose.candidate).valid).toBe(false);
 const bounds=fixture();bounds.attachment.anchor[0]=4;
 Object.assign(bounds.placement,ceilingRailDerivedPose(ceilingRailAttachmentMatrix(bounds.surface,bounds.attachment).matrix));
 expect(validateWorkspaceFurnishings(bounds.candidate).valid).toBe(false);
 const missing=fixture();missing.extension.ceilingAttachments=[];
 expect(validateWorkspaceFurnishings(missing.candidate).valid).toBe(false);
 const source=fixture();source.descriptor.fit.sourceSha256='b'.repeat(64);
 expect(validateWorkspaceFurnishings(source.candidate).valid).toBe(false);
 const nonfinite=fixture();nonfinite.placement.position[1]=NaN;
 expect(validateWorkspaceFurnishings(nonfinite.candidate).valid).toBe(false);
});

it('retains strict room-center limits for ordinary room visuals in the same v11 envelope',()=>{
 const {candidate,extension,placement,descriptor}=fixture();
 const {fit:_,...ordinary}=descriptor;void _;
 extension.furnishings=[{...ordinary,kind:'display-case'}] as typeof extension.furnishings;
 extension.ceilingAttachments=[];
 placement.position=[0,4,0];
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);
 placement.position[1]=4.000000000000001;
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);
 placement.position=[0,-Number.EPSILON,0];
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);
 placement.position=[4.000000000000001,0,0];
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);
});
