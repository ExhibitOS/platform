// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect,vi} from 'vitest';
import * as three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {INSTALLATION_NAMESPACE as N} from '@exhibitos/studio-contract';
import {installDecor} from './installation-renderer';
const id='aaaaaaaa-0000-4000-8000-000000000001',revision='aaaaaaaa-0000-4000-8000-000000000002',pose=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}),material={preset:'paint',color:'#FFFFFF',roughness:.7,metalness:0};
function fixture(matWidth=.04){const doc={rooms:[{id:revision,dimensions:{width:3000,height:10,depth:20},transform:pose()}],artworks:[{revisionId:revision,artworkType:'image',dimensions:{width:2,height:1},transform:pose()}],placements:[{id,roomId:revision,artworkRevisionId:revision,transform:{...pose(),position:[0,1.5,-3]}}],extensions:{[N]:{version:1,placements:[{placementId:id,pedestal:{kind:'box',position:[2,0,0],yaw:0,dimensions:{width:1,depth:1,height:.8},material},frame:{kind:'flat',borderWidth:.1,thickness:.02,depth:.02,gap:0,matWidth,matColor:'#EEEEEE',material}}]}}} as unknown as Exhibition;const room=new three.Group(),asset=new three.Group();room.add(asset);return {doc,room,asset,decor:installDecor(three,doc,new Map([[revision,room]]))};}
const positions=(mesh:three.Object3D)=>Array.from((mesh as three.Mesh).geometry.getAttribute('position').array);
test('room sibling decoration batches survive artwork LOD replacement and dispose each owned resource once',()=>{
 const {room,asset,decor}=fixture(),group=decor.groups.get(id)!,meshes=group.children as three.Mesh[];expect(decor.primitiveCount).toBe(9);expect(meshes).toHaveLength(3);expect(group.parent).toBe(room);asset.add(new three.Group());asset.clear();asset.add(new three.Group());expect(group.parent).toBe(room);expect(group.children).toEqual(meshes);
 const geometrySpies=meshes.map(m=>vi.spyOn(m.geometry,'dispose')),materials=new Set(meshes.map(m=>m.material as three.Material)),materialSpies=[...materials].map(m=>vi.spyOn(m,'dispose'));decor.dispose();decor.dispose();expect(group.parent).toBeNull();for(const spy of [...geometrySpies,...materialSpies])expect(spy).toHaveBeenCalledTimes(1);
});
test('placement preview and cancel update frame buffers in place while independent pedestal and materials remain stable',()=>{
 const {doc,decor}=fixture(),group=decor.groups.get(id)!,geometries=group.children.map(m=>(m as three.Mesh).geometry),materials=group.children.map(m=>(m as three.Mesh).material),before=group.children.map(positions),next=structuredClone(doc);next.placements[0]!.transform.position[0]+=2;
 expect(decor.preview(next,id)).toBe(0);expect(positions(group.children[0]!)).toEqual(before[0]);for(let i=1;i<group.children.length;i++){const actual=positions(group.children[i]!);for(let j=0;j<actual.length;j++)expect(actual[j]).toBeCloseTo(before[i]![j]!+(j%3===0?2:0),5);}
 expect(group.children.map(m=>(m as three.Mesh).geometry)).toEqual(geometries);expect(group.children.map(m=>(m as three.Mesh).material)).toEqual(materials);expect(decor.preview(doc,id)).toBe(0);expect(group.children.map(positions)).toEqual(before);decor.dispose();
});
test('a collapsed frame preview hides only that component and cancel restores its same buffers',()=>{
 const {doc,decor}=fixture(1e-6),group=decor.groups.get(id)!,before=group.children.map(positions),next=structuredClone(doc);expect(decor.issues).toEqual([]);next.placements[0]!.transform.position[0]=1000;
 expect(decor.preview(next,id)).toBe(1);expect(group.children[0]!.visible).toBe(true);expect(group.children.slice(1).every(m=>!m.visible)).toBe(true);expect(decor.preview(doc,id)).toBe(0);expect(group.children.every(m=>m.visible)).toBe(true);expect(group.children.map(positions)).toEqual(before);decor.dispose();
});
