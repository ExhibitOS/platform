// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {paintingWasherCandidate,lightId,assetId} from '../test-fixtures/wallwasher.js';
import {applyLightObjectCommand} from './light-object.js';
import {lightAttachmentPose} from './room-envelope.js';
import {furnishingsFor,resolveFurnishing,validateFurnishings} from './furnishings.js';
import {WORKSPACE_FURNISHING_NAMESPACE,ceilingRailAttachmentMatrix,ceilingRailDerivedPose,validateWorkspaceFurnishings} from './workspace-furnishing.js';
import {trackSpotStaticRailContext} from './wallwasher-coupled-fixture.js';
import type {Exhibition} from '@exhibitos/spec';
const rid='b0000000-0000-4000-8000-000000000001',pid='b0000000-0000-4000-8000-000000000002';
export function staticTrackCandidate(){
 const {moved}=paintingWasherCandidate(),surface=moved.surfaces[0]!,room=moved.rooms[0]!;
 const attachment={placementId:pid,surfaceId:surface.id,anchor:[-1.402,2.5] as [number,number],yaw:-Math.PI/2,gap:0};
 const placement={id:pid,roomId:room.id,furnishingId:rid,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)};
 const model={mime:'model/gltf-binary',sha256:'a'.repeat(64),bytes:200};
 moved.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[{id:rid,version:1,kind:'ceiling-rail',name:'Synthetic rail',provenance:'Synthetic measured source',rights:{holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:true}},model,fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}}}],placements:[placement],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const exit=.0755/Math.SQRT2,emitter:[number,number,number]=[-1.402-exit,3.815-exit,2.5],mount={surfaceId:surface.id,anchor:[emitter[0],emitter[2]] as [number,number],gap:4-emitter[1]},pose=lightAttachmentPose(surface,{...mount,lightId});
 const {id:_,...fields}=moved.lights[0]!;void _;
 const aimed=applyLightObjectCommand(moved,{type:'set-light-object',lightId,light:{...fields,transform:pose},settings:{fixture:'none',aim:{kind:'point',position:[-3.917,1.3,2.5]},range:4.4,penumbra:.35},attachment:mount}).candidate;
 return applyLightObjectCommand(aimed,{type:'set-light-fixture',lightId,visual:{catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}}},{newAssetId:assetId}).candidate;
}
function resolve(document:Exhibition){const f=furnishingsFor(document)!;return resolveFurnishing(document,f.bindings[0]!,f.assets[0]!);}
it('admits only the source-selected -45 static head on one coherent rail and survives JSON reopen',()=>{
 const e=staticTrackCandidate();expect(validateWorkspaceFurnishings(e).valid).toBe(true);expect(validateFurnishings(e).valid).toBe(true);expect(trackSpotStaticRailContext(e,lightId)).toBe(true);
 const r=resolve(e);expect('wallwasher' in r).toBe(true);if(!('wallwasher'in r))throw Error('expected static');
 expect(r.mountProfile).toBe('museum-track-spot-fixed-head-v1');expect(r.wallwasher.headPitch).toBe(-Math.PI/4);expect(r.wallwasher.parts).toHaveLength(14);expect(r.wallwasher.fixedPose.position[0]).toBeCloseTo(-1.402,9);expect(r.wallwasher.fixedPose.position[1]).toBeCloseTo(3.965,9);expect(resolve(JSON.parse(JSON.stringify(e)))).toEqual(r);
});
it('keeps existing generic whole-model catalogue mode when no rail mount context exists',()=>{
 const e=staticTrackCandidate();delete e.extensions![WORKSPACE_FURNISHING_NAMESPACE];expect(trackSpotStaticRailContext(e,lightId)).toBe(false);expect(validateFurnishings(e).valid).toBe(true);expect('wallwasher'in resolve(e)).toBe(false);
});
it.each(['wrong-pitch','no-contact','ambiguous-contact'])('fails closed after static context selection: %s',kind=>{
 const e=staticTrackCandidate(),rail=e.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {placements:{id:string;position:number[]}[];ceilingAttachments:{placementId:string;anchor:number[]}[]};
 if(kind==='wrong-pitch'){const details=e.extensions!['org.exhibitos.studio/light-details'] as unknown as {lights:{aim:{position:number[]}}[]};details.lights[0]!.aim.position[1]=2;}
 if(kind==='no-contact'){rail.placements[0]!.position[0]+=.1;rail.ceilingAttachments[0]!.anchor[0]+=.1;}
 if(kind==='ambiguous-contact'){const id='b0000000-0000-4000-8000-000000000003';rail.placements.push({...structuredClone(rail.placements[0]!),id});rail.ceilingAttachments.push({...structuredClone(rail.ceilingAttachments[0]!),placementId:id});}
 expect(trackSpotStaticRailContext(e,lightId)).toBe(true);expect(validateFurnishings(e).valid).toBe(false);
});

it('uses only contact rails on the selected ceiling and ignores other-surface contact duplicates',()=>{
 const e=staticTrackCandidate(),rail=e.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {placements:{id:string;position:number[]}[];ceilingAttachments:{placementId:string;surfaceId:string;anchor:number[]}[]};
 const other='b0000000-0000-4000-8000-000000000004',duplicate='b0000000-0000-4000-8000-000000000005';
 e.surfaces.push({...structuredClone(e.surfaces[0]!),id:other});rail.placements.push({...structuredClone(rail.placements[0]!),id:duplicate});rail.ceilingAttachments.push({...structuredClone(rail.ceilingAttachments[0]!),placementId:duplicate,surfaceId:other});
 expect(validateWorkspaceFurnishings(e).valid).toBe(true);expect(validateFurnishings(e).valid).toBe(true);
 rail.placements[0]!.position[0]+=.2;rail.ceilingAttachments[0]!.anchor[0]+=.2;
 expect(trackSpotStaticRailContext(e,lightId)).toBe(true);expect(validateWorkspaceFurnishings(e).valid).toBe(true);expect(validateFurnishings(e).valid).toBe(false);
});
it('uses the actual admitted rail height for nonzero ceiling gap',()=>{
 const e=staticTrackCandidate(),rail=e.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {placements:{position:number[]}[];ceilingAttachments:{gap:number}[]};
 rail.placements[0]!.position[1]-=.02;rail.ceilingAttachments[0]!.gap=.02;
 e.lights[0]!.transform.position[1]-=.02;
 const attached=e.extensions!['org.exhibitos.studio/light-attachments'] as unknown as {lights:{gap:number}[]};attached.lights[0]!.gap+=.02;
 const details=e.extensions!['org.exhibitos.studio/light-details'] as unknown as {lights:{aim:{position:number[]}}[]};details.lights[0]!.aim.position[1]-=.02;
 expect(validateWorkspaceFurnishings(e).valid).toBe(true);expect(validateFurnishings(e).valid).toBe(true);
 const r=resolve(e);if(!('wallwasher'in r))throw Error('expected static');expect(r.wallwasher.fixedPose.position[1]).toBeCloseTo(3.945,9);
});

function groupedTrackCandidate(e=staticTrackCandidate()){
 e.rooms[0]!.dimensions.depth=10;e.surfaces[0]!.dimensions.height=10;
 const rail=e.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {furnishings:{model:unknown;fit:unknown}[];placements:{position:number[];yaw:number}[];ceilingAttachments:{anchor:number[];yaw:number}[]};
 const model={mime:'model/gltf-binary',sha256:'5cc5d772acd4087c5d7d26b5f24e2fe38626b1315e377210410954abf7d4ff44',bytes:377576};
 rail.furnishings[0]!.model=model;rail.furnishings[0]!.fit={version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'passive-ceiling-rail-v1',min:[-3.2175,-.035,-2.698],max:[2.648545,0,2.548]}};
 rail.placements[0]!.position=[0,4,0];rail.placements[0]!.yaw=0;rail.ceilingAttachments[0]!.anchor=[0,0];rail.ceilingAttachments[0]!.yaw=0;
 return e;
}
it('resolves a perpendicular off-origin fixture on actual grouped contact geometry without editing its light or binding',()=>{
 const e=staticTrackCandidate(),lights=structuredClone(e.lights),bindings=structuredClone(furnishingsFor(e)!.bindings),grouped=groupedTrackCandidate(structuredClone(e));
 expect(validateWorkspaceFurnishings(grouped).valid).toBe(true);expect(validateFurnishings(grouped).valid).toBe(true);
 const before=resolve(e),after=resolve(grouped);expect('wallwasher'in before&&'wallwasher'in after).toBe(true);
 if(!('wallwasher'in before)||!('wallwasher'in after))throw Error('expected coupled');
 expect(after.wallwasher).toEqual(before.wallwasher);expect(grouped.lights).toEqual(lights);expect(furnishingsFor(grouped)!.bindings).toEqual(bindings);
 expect(resolve(JSON.parse(JSON.stringify(grouped)))).toEqual(after);
});
it('rejects a grouped mount shifted off the certified contact even while inside its aggregate bounds',()=>{
 const e=groupedTrackCandidate(),rail=e.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {placements:{position:number[]}[];ceilingAttachments:{anchor:number[]}[]};
 rail.placements[0]!.position[0]=.03;rail.ceilingAttachments[0]!.anchor[0]=.03;
 expect(validateWorkspaceFurnishings(e).valid).toBe(true);expect(()=>resolve(e)).toThrow('TRACK_SPOT_RAIL_CONTACT_UNAVAILABLE');
});
it('checks grouped contact in source coordinates under a rotated rail placement',()=>{
 const e=groupedTrackCandidate(),yaw=.2,c=Math.cos(yaw),s=Math.sin(yaw),rotate=(p:number[])=>[c*p[0]!+s*p[2]!,p[1]!,-s*p[0]!+c*p[2]!] as [number,number,number];
 const rail=e.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {placements:{yaw:number}[];ceilingAttachments:{yaw:number}[]};rail.placements[0]!.yaw=yaw;rail.ceilingAttachments[0]!.yaw=yaw;
 const light=e.lights[0]!,position=rotate(light.transform.position);light.transform.position=position;
 const attachment=e.extensions!['org.exhibitos.studio/light-attachments'] as unknown as {lights:{anchor:number[]}[]};attachment.lights[0]!.anchor=[position[0],position[2]];
 const details=e.extensions!['org.exhibitos.studio/light-details'] as unknown as {lights:{aim:{position:number[]}}[]};details.lights[0]!.aim.position=rotate(details.lights[0]!.aim.position);
 expect(validateWorkspaceFurnishings(e).valid).toBe(true);expect(validateFurnishings(e).valid).toBe(true);expect('wallwasher'in resolve(e)).toBe(true);
});
