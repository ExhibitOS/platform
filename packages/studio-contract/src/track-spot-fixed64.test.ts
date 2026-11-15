// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {museumTrackSpotProfile,MUSEUM_TRACK_SPOT_IDENTITY,MUSEUM_TRACK_SPOT_FIXED64_IDENTITY,MUSEUM_TRACK_SPOT_FIXED64_PROFILE,MUSEUM_TRACK_SPOT_FIXED64_PITCH} from './track-spot-profile.js';
import {resolveWallwasherMountHead} from './wallwasher-mount-head.js';
import {rectangularRailContact,RECTANGULAR_RAIL_CONTACT_QUADS} from './rectangular-rail-contact.js';
import {type WorkspaceFurnishingDescriptor,WORKSPACE_FURNISHING_NAMESPACE,ceilingRailAttachmentMatrix,ceilingRailDerivedPose} from './workspace-furnishing.js';
import {paintingWasherCandidate,lightId,assetId} from '../test-fixtures/wallwasher.js';
import {lightAttachmentPose} from './room-envelope.js';
import {applyLightObjectCommand} from './light-object.js';
import {furnishingsFor,resolveFurnishing,validateFurnishings} from './furnishings.js';
const sha='aca126489bf21adcc637e9a3c3bb805bb57f93111c3333a8fdefab9d371d1c42';
const descriptor=():WorkspaceFurnishingDescriptor=>({id:'b0000000-0000-4000-8000-000000000001',version:1,kind:'ceiling-rail',name:'Rectangle',provenance:'Redistributable authored source',rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},model:{mime:'model/gltf-binary',sha256:sha,bytes:268820},fit:{version:1,sourceSha256:sha,sourceBytes:268820,geometry:{profile:'passive-ceiling-rail-v1',min:[-2.809499979019165,-.03500000014901161,-3.809499979019165],max:[2.809499979019165,0,3.809499979019165]}}});
const mount={position:[0,4,0],rotation:[0,0,0,1],scale:[1,1,1]} as const,ceiling={pose:{...mount,rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2] as const},dimensions:{width:12,height:12}};
it('preserves the original source and admits only the exact new source singleton, including direct algebra calls',()=>{
 expect(museumTrackSpotProfile(MUSEUM_TRACK_SPOT_IDENTITY).headPitchIntervals).toEqual([[-Math.PI/4,-Math.PI/4]]);
 const p=museumTrackSpotProfile(MUSEUM_TRACK_SPOT_FIXED64_IDENTITY);expect(p).toBe(MUSEUM_TRACK_SPOT_FIXED64_PROFILE);
 expect(resolveWallwasherMountHead({profile:p,mountPose:mount,headPitch:MUSEUM_TRACK_SPOT_FIXED64_PITCH,ceilingSurface:ceiling}).parts).toHaveLength(14);
 for(const pitch of [-Math.PI/4,0,MUSEUM_TRACK_SPOT_FIXED64_PITCH-1e-12,MUSEUM_TRACK_SPOT_FIXED64_PITCH+1e-12])expect(()=>resolveWallwasherMountHead({profile:{...p,headPitchIntervals:[[pitch,pitch]]},mountPose:mount,headPitch:pitch,ceilingSurface:ceiling})).toThrow('WASHER_PITCH_NOT_APPROVED');
 expect(()=>museumTrackSpotProfile({...MUSEUM_TRACK_SPOT_FIXED64_IDENTITY,sha256:MUSEUM_TRACK_SPOT_IDENTITY.sha256})).toThrow('WASHER_CATALOGUE_IDENTITY_MISMATCH');
 const changed={...p,fixedParts:p.fixedParts.map((part,i)=>i?part:{...part,bounds:{...part.bounds,max:[part.bounds.max[0]+.01,part.bounds.max[1],part.bounds.max[2]] as const}})};
 expect(()=>resolveWallwasherMountHead({profile:changed,mountPose:mount,headPitch:MUSEUM_TRACK_SPOT_FIXED64_PITCH,ceilingSurface:ceiling})).toThrow('WASHER_PARTITION_INVALID');
});
it('binds all nine contact regions to actual coplanar triangles of the exact new rectangle original',async()=>{
 const body=await readFile(new URL('../../../assets/furnishings/exhibitos-authored-20261115/painting-rectangular-dark-track/model.glb',import.meta.url));expect(createHash('sha256').update(body).digest('hex')).toBe(sha);
 const length=body.readUInt32LE(12),doc=JSON.parse(body.subarray(20,20+length).toString()),bin=body.subarray(28+length),node=doc.nodes.find((n:{name:string})=>n.name==='Connected track body');
 expect(node.translation).toBeUndefined();expect(node.rotation).toBeUndefined();expect(node.scale).toBeUndefined();expect(node.matrix).toBeUndefined();
 const primitive=doc.meshes[node.mesh].primitives[0],accessor=(id:number)=>{const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],width=a.type==='VEC3'?3:1,size=a.componentType===5126||a.componentType===5125?4:2;expect([5126,5123,5125]).toContain(a.componentType);return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>{const offset=(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??width*size)+j*size;return a.componentType===5126?bin.readFloatLE(offset):size===4?bin.readUInt32LE(offset):bin.readUInt16LE(offset);}));};
 type P=readonly [number,number];
 const cross=(a:P,b:P,p:P)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
 const area=(poly:readonly P[])=>Math.abs(poly.reduce((n,a,i)=>{const b=poly[(i+1)%poly.length]!;return n+a[0]*b[1]-b[0]*a[1];},0))/2;
 const clip=(triangle:P[],quad:readonly P[])=>{let points=triangle;for(let i=0;i<quad.length;i++){const a=quad[i]!,b=quad[(i+1)%quad.length]!,out:P[]=[];for(let j=0;j<points.length;j++){const p=points[j]!,q=points[(j+1)%points.length]!,cp=cross(a,b,p),cq=cross(a,b,q),pin=cp>=-1e-12,qin=cq>=-1e-12;if(pin)out.push(p);if(pin!==qin){const t=cp/(cp-cq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}}points=out;}return points;};
 const positions=accessor(primitive.attributes.POSITION),indices=accessor(primitive.indices).flat(),triangles:P[][]=[];
 for(let i=0;i<indices.length;i+=3){const p=indices.slice(i,i+3).map(id=>positions[id]!);if(p.every(v=>Math.abs(v[1]!+.035)<1e-6))triangles.push(p.map(v=>[v[0]!,v[2]!]));}
 for(const q of RECTANGULAR_RAIL_CONTACT_QUADS){const ratio=triangles.reduce((n,t)=>n+area(clip(t,q)),0)/area(q);expect(Math.abs(ratio-1)).toBeLessThan(2e-4);}
});
it('requires every adapter corner on one source-bound contact region, not its aggregate bounds',()=>{
 for(const q of RECTANGULAR_RAIL_CONTACT_QUADS){const points=q.map(([x,z])=>[x,-.035,z] as [number,number,number]);expect(rectangularRailContact(descriptor(),points)).toBe(true);expect(rectangularRailContact(descriptor(),points.map(([x,y,z])=>[x+.02,y,z]))).toBe(false);}
 for(const kind of ['bytes','fit-hash','bounds','plane']){const d=descriptor(),points=RECTANGULAR_RAIL_CONTACT_QUADS[0]!.map(([x,z])=>[x,kind==='plane'?-.034:-.035,z] as [number,number,number]);if(kind==='bytes')d.model.bytes++;if(kind==='fit-hash')d.fit!.sourceSha256='f'.repeat(64);if(kind==='bounds'&&d.fit!.geometry.profile==='passive-ceiling-rail-v1')d.fit!.geometry.max[0]+=.01;expect(rectangularRailContact(d,points)).toBe(false);}
 expect(rectangularRailContact({...descriptor(),model:{...descriptor().model,sha256:'f'.repeat(64)}},[])).toBeUndefined();
});
it('round-trips a mounted new fixture through existing complete furnishing admission without changing stored light poses',()=>{
 const e=paintingWasherCandidate().moved,room=e.rooms[0]!,surface=e.surfaces[0]!,d=descriptor(),pid='b0000000-0000-4000-8000-000000000002';room.dimensions.width=12;room.dimensions.depth=12;surface.dimensions={width:12,height:12};
 const attachment={placementId:pid,surfaceId:surface.id,anchor:[0,0] as [number,number],yaw:0,gap:0};
 e.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[d],placements:[{id:pid,roomId:room.id,furnishingId:d.id,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const theta=MUSEUM_TRACK_SPOT_FIXED64_PITCH,emitter:[number,number,number]=[-2.2,3.965-.15+.0755*Math.sin(theta),-3.79-.0755*Math.cos(theta)],a={surfaceId:surface.id,anchor:[emitter[0],emitter[2]] as [number,number],gap:4-emitter[1]},pose=lightAttachmentPose(surface,{...a,lightId}),{id:_,...fields}=e.lights[0]!;void _;
 const aimed=applyLightObjectCommand(e,{type:'set-light-object',lightId,light:{...fields,transform:pose},settings:{fixture:'none',aim:{kind:'point',position:[emitter[0],emitter[1]+2.5*Math.sin(theta),emitter[2]-2.5*Math.cos(theta)]}},attachment:a}).candidate;
 const candidate=applyLightObjectCommand(aimed,{type:'set-light-fixture',lightId,visual:{catalogId:'museum-track-spot-fixed-64p1',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}}},{newAssetId:assetId}).candidate,before=structuredClone(candidate),f=furnishingsFor(candidate)!,resolved=resolveFurnishing(candidate,f.bindings[0]!,f.assets[0]!);
 expect(validateFurnishings(candidate).valid).toBe(true);expect(candidate).toEqual(before);expect('wallwasher' in resolved&&resolved.wallwasher.headPitch).toBe(theta);expect(validateFurnishings(JSON.parse(JSON.stringify(candidate))).valid).toBe(true);
 delete candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE];expect(validateFurnishings(candidate).valid).toBe(false);
});
it('pins the actual new REST0 GLB partition and bounds rather than trusting copied metadata',async()=>{
 const body=await readFile(new URL('../../../assets/furnishings/exhibitos-authored-20261115/museum-track-spot-fixed-64p1/model.glb',import.meta.url));expect(body.length).toBe(255228);expect(createHash('sha256').update(body).digest('hex')).toBe(MUSEUM_TRACK_SPOT_FIXED64_IDENTITY.sha256);
 const length=body.readUInt32LE(12),doc=JSON.parse(body.subarray(20,20+length).toString()),bin=body.subarray(28+length),profile=MUSEUM_TRACK_SPOT_FIXED64_PROFILE;let triangles=0;
 expect(doc.nodes).toHaveLength(14);
 for(const node of doc.nodes){expect(node.rotation).toBeUndefined();expect(node.scale).toBeUndefined();expect(node.matrix).toBeUndefined();expect(node.children).toBeUndefined();const part=[...profile.fixedParts,...profile.headParts].find(p=>p.name===node.name)!;expect(part).toBeDefined();const points:number[][]=[];
  for(const primitive of doc.meshes[node.mesh].primitives){const a=doc.accessors[primitive.attributes.POSITION],v=doc.bufferViews[a.bufferView];expect(a.componentType).toBe(5126);for(let i=0;i<a.count;i++)points.push([0,1,2].map(axis=>bin.readFloatLE((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??12)+axis*4)+(node.translation?.[axis]??0)));triangles+=doc.accessors[primitive.indices].count/3;}
  for(let i=0;i<3;i++){expect(Math.min(...points.map(p=>p[i]!))).toBeCloseTo(part.bounds.min[i]!,10);expect(Math.max(...points.map(p=>p[i]!))).toBeCloseTo(part.bounds.max[i]!,10);}
 }
 expect(triangles).toBe(4260);
});
