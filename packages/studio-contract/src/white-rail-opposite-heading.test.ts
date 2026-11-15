// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {whiteRailOppositeHeading} from './white-rail-opposite-heading.js';
import {type WorkspaceFurnishingDescriptor,WORKSPACE_FURNISHING_NAMESPACE,ceilingRailAttachmentMatrix,ceilingRailDerivedPose} from './workspace-furnishing.js';
import {paintingWasherCandidate,lightId,assetId} from '../test-fixtures/wallwasher.js';
import {lightAttachmentPose} from './room-envelope.js';
import {applyLightObjectCommand} from './light-object.js';
import {furnishingsFor,resolveFurnishing,validateFurnishings} from './furnishings.js';
const sha256='1ba64842de525166018e941074852a3e041d07adf605674c7d7fadb02693a09e';
const descriptor=():WorkspaceFurnishingDescriptor=>({id:'b0000000-0000-4000-8000-000000000001',version:1,kind:'ceiling-rail',name:'White rail',provenance:'Redistributable source geometry',rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},model:{mime:'model/gltf-binary',sha256,bytes:187688},fit:{version:1,sourceSha256:sha256,sourceBytes:187688,geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}}});

it('allows exactly the certified reverse heading including quaternion sign, not perpendicular or tilted mounts',()=>{
 const d=descriptor();expect(whiteRailOppositeHeading(d,[0,1,0,0],[0,0,0,1])).toBe(true);expect(whiteRailOppositeHeading(d,[0,-1,0,0],[0,0,0,1])).toBe(true);
 expect(whiteRailOppositeHeading(d,[0,Math.SQRT1_2,0,Math.SQRT1_2],[0,0,0,1])).toBe(false);expect(whiteRailOppositeHeading(d,[Math.SQRT1_2,Math.SQRT1_2,0,0],[0,0,0,1])).toBe(false);
});
it.each(['hash','bytes','fit-hash','fit-bytes','bounds'])('does not grant the reverse heading to an unqualified source: %s',kind=>{
 const d=descriptor();if(kind==='hash')d.model.sha256='a'.repeat(64);if(kind==='bytes')d.model.bytes++;if(kind==='fit-hash')d.fit!.sourceSha256='a'.repeat(64);if(kind==='fit-bytes')d.fit!.sourceBytes++;if(kind==='bounds'&&d.fit!.geometry.profile==='passive-ceiling-rail-v1')d.fit!.geometry.max[0]=.6;
 expect(whiteRailOppositeHeading(d,[0,1,0,0],[0,0,0,1])).toBe(false);
});

function reverseCandidate(){
 const candidate=paintingWasherCandidate().moved,surface=candidate.surfaces[0]!,room=candidate.rooms[0]!,d=descriptor(),pid='b0000000-0000-4000-8000-000000000002';
 // Fixture points west; the actual rail is coherent but faces east.
 const attachment={placementId:pid,surfaceId:surface.id,anchor:[-1.402,2.5] as [number,number],yaw:Math.PI/2,gap:0};
 candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[d],placements:[{id:pid,roomId:room.id,furnishingId:d.id,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const exit=.0755/Math.SQRT2,emitter:[number,number,number]=[-1.402-exit,3.815-exit,2.5],mount={surfaceId:surface.id,anchor:[emitter[0],emitter[2]] as [number,number],gap:4-emitter[1]},pose=lightAttachmentPose(surface,{...mount,lightId}),{id:_,...light}=candidate.lights[0]!;void _;
 const aimed=applyLightObjectCommand(candidate,{type:'set-light-object',lightId,light:{...light,transform:pose},settings:{fixture:'none',aim:{kind:'point',position:[-3.917,1.3,2.5]},range:4.4,penumbra:.35},attachment:mount}).candidate;
 return applyLightObjectCommand(aimed,{type:'set-light-fixture',lightId,visual:{catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}}},{newAssetId:assetId}).candidate;
}
it('admits actual reverse-source contact without rewriting stored lights, bindings or rail pose',()=>{
 const candidate=reverseCandidate(),before=structuredClone(candidate),f=furnishingsFor(candidate)!,result=resolveFurnishing(candidate,f.bindings[0]!,f.assets[0]!);
 expect(validateFurnishings(candidate).valid).toBe(true);expect('wallwasher' in result).toBe(true);expect(candidate).toEqual(before);expect(validateFurnishings(JSON.parse(JSON.stringify(candidate))).valid).toBe(true);
});
it.each(['unknown-source','off-centre','past-end','duplicate-contact'])('retains the remaining contact guards: %s',kind=>{
 const e=reverseCandidate(),ext=e.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {furnishings:WorkspaceFurnishingDescriptor[];placements:{id:string;position:number[]}[];ceilingAttachments:{placementId:string;anchor:number[]}[]};
 if(kind==='unknown-source'){ext.furnishings[0]!.model.sha256='a'.repeat(64);ext.furnishings[0]!.fit!.sourceSha256='a'.repeat(64);}
 if(kind==='off-centre'){ext.placements[0]!.position[0]+=.01;ext.ceilingAttachments[0]!.anchor[0]+=.01;}
 if(kind==='past-end'){ext.placements[0]!.position[2]+=.5;ext.ceilingAttachments[0]!.anchor[1]+=.5;}
 if(kind==='duplicate-contact'){const id='b0000000-0000-4000-8000-000000000003';ext.placements.push({...structuredClone(ext.placements[0]!),id});ext.ceilingAttachments.push({...structuredClone(ext.ceilingAttachments[0]!),placementId:id});}
 expect(validateFurnishings(e).valid).toBe(false);
});

it('binds the half-turn equivalence to every decoded source triangle and material, not its aggregate bounds',async()=>{
 const body=await readFile(new URL('../../../assets/furnishings/user-authored-20261027/linear-track/model.glb',import.meta.url));expect(body.length).toBe(187688);expect(createHash('sha256').update(body).digest('hex')).toBe(sha256);
 const length=body.readUInt32LE(12),doc=JSON.parse(body.subarray(20,20+length).toString()),bin=body.subarray(28+length);
 const accessor=(id:number)=>{const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],width=a.type==='VEC3'?3:1,size=a.componentType===5126||a.componentType===5125?4:2;expect([5126,5125,5123]).toContain(a.componentType);return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>{const offset=(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??width*size)+j*size;return a.componentType===5126?bin.readFloatLE(offset):size===4?bin.readUInt32LE(offset):bin.readUInt16LE(offset);}));};
 const original:string[]=[],opposite:string[]=[],key=(points:number[][],material:number)=>JSON.stringify([material,points.map(p=>p.map(n=>Math.round(n*1e6))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
 for(const node of doc.nodes){expect(node.rotation).toBeUndefined();expect(node.scale).toBeUndefined();expect(node.matrix).toBeUndefined();expect(node.children).toBeUndefined();for(const primitive of doc.meshes[node.mesh].primitives){const positions=accessor(primitive.attributes.POSITION).map(p=>p.map((n,i)=>n+(node.translation?.[i]??0))),indices=accessor(primitive.indices).flat();for(let i=0;i<indices.length;i+=3){const triangle=indices.slice(i,i+3).map(id=>positions[id]!);original.push(key(triangle,primitive.material));opposite.push(key(triangle.map(([x,y,z])=>[-x!,y!,-z!]),primitive.material));}}}
 expect(original).toHaveLength(1880);expect(opposite.sort()).toEqual(original.sort());
});
