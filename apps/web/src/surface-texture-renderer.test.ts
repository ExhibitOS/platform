// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {expect,test} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {MATERIAL_NAMESPACE,surfaceTextureDefaults,applyArchitecturalFinishCommand,wallFinishesFor,architecturalWallBoxes,type SurfaceTextureBinding} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {whiteCubeSurfaces} from './geometry/model';
import {texturedWallGeometry} from './architectural-finishes-renderer';
import {surfaceTexturePlan} from './surface-texture-renderer';
import {DEVICE_BUDGETS} from './viewer/loading';
const id='aaaaaaaa-0000-4000-8000-000000000001';
test('actual2K roles reserve source decode cost, select independent scalar size, and never silently drop a role',()=>{
 const doc={surfaces:[{id,type:'wall'}],extensions:{[MATERIAL_NAMESPACE]:{version:1,surfaces:{},surfaceTextures:{[id]:surfaceTextureDefaults('museum-matte-paint').texture}}}} as unknown as Exhibition;
 const plan=surfaceTexturePlan(doc,2048,96*1024*1024),pack=plan.packs[0]!;
 expect(pack.maps.color.width).toBe(2048);expect(plan.sizeFor(pack.maps.color)).toBe(plan.sizeFor(pack.maps.normal));expect(plan.sizeFor(pack.maps.roughness)).toBe(plan.sizeFor(pack.maps.normal)/2);expect(plan.reserveBytes).toBeLessThanOrEqual(96*1024*1024*.65);
 const small=surfaceTexturePlan(doc,512,24*1024*1024);expect(small.packs).toEqual([]);expect(small.blocked).toEqual(['museum-matte-paint']);
});
test('one2K editor pack needs the existing desktop resource budget after overhead',()=>{
 const doc={surfaces:[{id,type:'wall'}],extensions:{[MATERIAL_NAMESPACE]:{version:1,surfaces:{},surfaceTextures:{[id]:surfaceTextureDefaults('museum-matte-paint').texture}}}} as unknown as Exhibition;
 // Reserve the same existing environment and shadow costs before material planning.
 const overhead=3932160+2097152,budget=DEVICE_BUDGETS.desktop;
 expect(surfaceTexturePlan(doc,2048,32*1024*1024-overhead).blocked).toEqual(['museum-matte-paint']);
 const plan=surfaceTexturePlan(doc,budget.maxTextureSize,budget.maxCacheBytes-overhead);
 expect(plan.blocked).toEqual([]);expect(plan.packs.map(p=>p.id)).toEqual(['museum-matte-paint']);
 expect(plan.reserveBytes).toBeGreaterThan(plan.residentBytes);
});
test('opening-split wall structures retain metric front/reveal UVs and one combined mesh geometry',()=>{
 const parent=new three.Group();parent.scale.set(2,3,4);
 const binding:SurfaceTextureBinding={...surfaceTextureDefaults('museum-matte-paint').texture,repeatMeters:[2,4]};
 const boxes=[{kind:'structure' as const,position:[-1,0,0] as [number,number,number],dimensions:{width:2,height:2,depth:.2}},{kind:'structure' as const,position:[1,0,0] as [number,number,number],dimensions:{width:2,height:2,depth:.2}}];
 const g=texturedWallGeometry(three,boxes,parent,binding),p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv');
 expect(p.count).toBe(48);expect(g.index!.count).toBe(72);
 for(let i=0;i<p.count;i++){
  if(Math.abs(n.getZ(i))>.5){expect(uv.getX(i)).toBeCloseTo(p.getX(i));expect(uv.getY(i)).toBeCloseTo(p.getY(i)*.75);}
  if(Math.abs(n.getX(i))>.5){expect(uv.getX(i)).toBeCloseTo(p.getZ(i)*2);expect(uv.getY(i)).toBeCloseTo(p.getY(i)*.75);}
 }
 g.computeBoundingBox();expect(g.boundingBox!.min.x).toBe(-2);expect(g.boundingBox!.max.x).toBe(2);g.dispose();
});
test('styled material geometry reserves both actual CPU and GPU buffers even on texture fallback',()=>{
 let d=newDraft().candidate;d.surfaces=whiteCubeSurfaces(d.rooms[0]!);const wall=d.surfaces.find(s=>s.type==='wall')!;
 d=applyArchitecturalFinishCommand(d,{type:'set-wall-finish',wall:{surfaceId:wall.id,depth:.12,preset:'dark-edge',trimWidth:.04,baseboardHeight:.1,ceilingBand:true}});
 const binding=surfaceTextureDefaults('museum-matte-paint').texture;d.extensions={...d.extensions,[MATERIAL_NAMESPACE]:{version:1,surfaces:{},surfaceTextures:{[wall.id]:binding}}} as unknown as Exhibition['extensions'];
 const boxes=architecturalWallBoxes(wall,d.openings,wallFinishesFor(d)[0]!).filter(b=>b.kind==='structure'),geometry=texturedWallGeometry(three,boxes,new three.Group(),binding),plan=surfaceTexturePlan(d,512,1);
 const cpu=Object.values(geometry.attributes).reduce((sum,a)=>sum+(a instanceof three.InterleavedBufferAttribute?a.data.array:a.array).byteLength,0)+geometry.index!.array.byteLength;
 expect(plan.geometryReserve).toBeGreaterThanOrEqual(2*cpu);expect(plan.reserveBytes).toBe(plan.geometryReserve);expect(plan.packs).toEqual([]);geometry.dispose();
});
