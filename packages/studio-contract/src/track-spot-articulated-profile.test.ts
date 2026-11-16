// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {ARTICULATED_TRACK_SPOT_IDENTITY,ARTICULATED_TRACK_SPOT_PROFILE,articulatedTrackSpotProfile} from './track-spot-articulated-profile.js';
import {MUSEUM_TRACK_SPOT_FIXED64_IDENTITY,MUSEUM_TRACK_SPOT_FIXED64_PITCH,MUSEUM_TRACK_SPOT_IDENTITY,museumTrackSpotProfile} from './track-spot-profile.js';
import {solveTrackSpotAiming} from './track-spot-aiming.js';
it('binds the single articulated profile to actual REST0 named parts and source bytes',async()=>{
 const bytes=await readFile(new URL('../../../assets/furnishings/exhibitos-authored-20261115/museum-track-spot-articulated/model.glb',import.meta.url));
 expect(bytes.length).toBe(ARTICULATED_TRACK_SPOT_IDENTITY.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(ARTICULATED_TRACK_SPOT_IDENTITY.sha256);
 const n=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+n).toString()),bin=bytes.subarray(28+n);let triangles=0;
 expect(doc.nodes).toHaveLength(14);expect(doc.meshes).toHaveLength(14);expect(doc.animations).toBeUndefined();expect(doc.skins).toBeUndefined();
 expect(new Set(doc.nodes.map((node:{name:string})=>node.name)).size).toBe(14);
 for(const node of doc.nodes){
  expect(node.rotation).toBeUndefined();expect(node.scale).toBeUndefined();expect(node.matrix).toBeUndefined();expect(node.children).toBeUndefined();
  const part=ARTICULATED_TRACK_SPOT_PROFILE.parts.find(p=>p.name===node.name);expect(part).toBeDefined();const points:number[][]=[];
  for(const primitive of doc.meshes[node.mesh].primitives){
   const a=doc.accessors[primitive.attributes.POSITION],v=doc.bufferViews[a.bufferView];expect(a.componentType).toBe(5126);expect(a.type).toBe('VEC3');
   for(let i=0;i<a.count;i++)points.push([0,1,2].map(j=>bin.readFloatLE((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??12)+4*j)+(node.translation?.[j]??0)));
   triangles+=doc.accessors[primitive.indices].count/3;
  }
  for(let j=0;j<3;j++){expect(Math.min(...points.map(p=>p[j]!))).toBeCloseTo(part!.bounds.min[j]!,12);expect(Math.max(...points.map(p=>p[j]!))).toBeCloseTo(part!.bounds.max[j]!,12);}
 }
 expect(triangles).toBe(5544);expect(ARTICULATED_TRACK_SPOT_PROFILE.parts.filter(p=>p.frame==='fixed')).toHaveLength(3);expect(ARTICULATED_TRACK_SPOT_PROFILE.parts.filter(p=>p.frame==='yoke')).toHaveLength(6);expect(ARTICULATED_TRACK_SPOT_PROFILE.parts.filter(p=>p.frame==='head')).toHaveLength(5);
});
it('keeps old fixed source authority and rejects mixed source identities',()=>{
 expect(articulatedTrackSpotProfile(ARTICULATED_TRACK_SPOT_IDENTITY)).toBe(ARTICULATED_TRACK_SPOT_PROFILE);
 for(const old of [MUSEUM_TRACK_SPOT_IDENTITY,MUSEUM_TRACK_SPOT_FIXED64_IDENTITY])expect(()=>articulatedTrackSpotProfile(old)).toThrow('TRACK_SPOT_AIM_SOURCE_MISMATCH');
 expect(()=>articulatedTrackSpotProfile({...ARTICULATED_TRACK_SPOT_IDENTITY,provenance:{...ARTICULATED_TRACK_SPOT_IDENTITY.provenance,sourceSha256:MUSEUM_TRACK_SPOT_FIXED64_IDENTITY.sha256}})).toThrow('TRACK_SPOT_AIM_SOURCE_MISMATCH');
 expect(museumTrackSpotProfile(MUSEUM_TRACK_SPOT_IDENTITY).headPitchIntervals).toEqual([[-Math.PI/4,-Math.PI/4]]);expect(museumTrackSpotProfile(MUSEUM_TRACK_SPOT_FIXED64_IDENTITY).headPitchIntervals).toEqual([[MUSEUM_TRACK_SPOT_FIXED64_PITCH,MUSEUM_TRACK_SPOT_FIXED64_PITCH]]);
});
it('uses the same source datums for the head and emitter while the fixed adapter stays unchanged',()=>{
 const mountPose={position:[0,4,0],rotation:[0,0,0,1],scale:[1,1,1]} as const,profile=ARTICULATED_TRACK_SPOT_PROFILE;
 for(const yaw of [-Math.PI,-.8,0,.8,Math.PI])for(const pitch of [-Math.PI/2,-.7,0]){
  const result=solveTrackSpotAiming({mountPose,geometry:profile.geometry,envelope:profile.envelope,intent:{kind:'manual',yaw,pitch}});
  expect(result.reachable).toBe(true);if(!result.reachable)throw Error(result.reason);expect(result.adapterPose).toEqual(mountPose);
  const target=result.emitter.map((n,i)=>n+2*result.direction[i]!) as [number,number,number],aimed=solveTrackSpotAiming({mountPose,geometry:profile.geometry,envelope:profile.envelope,intent:{kind:'target',point:target},previousAngles:{yaw,pitch}});
  expect(aimed.reachable).toBe(true);if(!aimed.reachable)throw Error(aimed.reason);expect(aimed.residual).toBeLessThan(1e-7);result.emitter.forEach((n,i)=>expect(aimed.emitter[i]).toBeCloseTo(n,10));
 }
});
