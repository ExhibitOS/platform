// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {FLOOR_NAMESPACE as N,validateStudioFloors,floorFor,remapStudioFloors,floorMaterial,floorPresetDefaults,type FloorBinding,type StudioFloors} from './floors.js';
const room='11111111-1111-4111-8111-111111111111',surface='22222222-2222-4222-8222-222222222222',media='33333333-3333-4333-8333-333333333333';
const binding=():FloorBinding=>({target:{kind:'surface',surfaceId:surface},preset:'wood',repeatMeters:[1.8,1.8],rotation:0});
const doc=(bindings:FloorBinding[]=[binding()])=>({rooms:[{id:room}],surfaces:[{id:surface,type:'floor',roomId:room}],mediaAssets:[{id:media,mime:'audio/wav'}],extensions:{[N]:{version:1 as const,bindings}}});
describe('typed floor metadata',()=>{
 it('preserves absent legacy sound and accepts explicit zeros with existing WAV only',()=>{
  const d=doc();expect(validateStudioFloors(d).valid).toBe(true);expect(floorFor(d,{roomId:room,surfaceId:surface})?.sound).toBeUndefined();
  d.extensions[N].bindings[0]!.sound={mode:'explicit',gain:0,assetIds:[media]};d.extensions[N].bindings[0]!.normalScale=0;d.extensions[N].bindings[0]!.aoStrength=0;expect(validateStudioFloors(d).valid).toBe(true);
  d.mediaAssets[0]!.mime='image/png';expect(validateStudioFloors(d).valid).toBe(false);
 });
 it('rejects duplicate typed IDs, nonfloor targets, malformed closed fields and cap violations',()=>{
  expect(validateStudioFloors(doc([binding(),{...binding(),target:{kind:'surface',surfaceId:surface.toUpperCase()}}])).valid).toBe(false);
  const wall=doc();wall.surfaces[0]!.type='wall';expect(validateStudioFloors(wall).valid).toBe(false);
  for(const patch of [{preset:['wood']},{texturePack:{id:['WoodFloor051'],version:1}},{sound:{mode:['none'],gain:1}},{materialOverride:{}},{materialOverride:{color:'#FFFFFF'}},{materialOverride:{unknown:1}},{normalScale:NaN},{repeatMeters:[0,1]},{sound:{mode:'none',gain:1,assetIds:[media]}},{sound:{mode:'explicit',gain:1,assetIds:[media,media]}}])expect(validateStudioFloors(doc([{...binding(),...patch} as FloorBinding])).valid).toBe(false);
  expect(validateStudioFloors(doc(Array.from({length:65},binding))).valid).toBe(false);
 });
 it('retains an inactive room base and never substitutes it for a real authored floor',()=>{
  const base={...binding(),target:{kind:'room-base' as const,roomId:room}};const d=doc([base]);expect(validateStudioFloors(d).valid).toBe(true);expect(floorFor(d,{roomId:room,surfaceId:surface})).toBeUndefined();
  d.surfaces=[];expect(floorFor(d,{roomId:room})?.target).toEqual(base.target);expect(d.extensions[N].bindings).toEqual([base]);
 });
 it('remaps only typed floor and explicit media references and fails missing mappings',()=>{
  const b=binding();b.sound={mode:'explicit',gain:1,assetIds:[media]};const value:StudioFloors={version:1,bindings:[b,{...binding(),target:{kind:'room-base',roomId:room}}]};
  const next=remapStudioFloors(value,new Map([[surface,room],[room,media],[media,surface]]));expect(next.bindings[0]!.target).toEqual({kind:'surface',surfaceId:room});expect(next.bindings[0]!.sound).toEqual({mode:'explicit',gain:1,assetIds:[surface]});expect(next.bindings[1]!.target).toEqual({kind:'room-base',roomId:media});expect(value.bindings[0]!.target).toEqual(b.target);
  expect(()=>remapStudioFloors(value,new Map([[surface,room]]))).toThrow('FLOOR_REFERENCE');
 });
 it('resolves scalar overrides per field while keeping authored legacy values and map factors',()=>{
  const b=binding();b.materialOverride={roughness:0};expect(floorMaterial(b,{color:'#123456',roughness:.8,metalness:.2})).toEqual({color:'#123456',roughness:0,metalness:.2});
  expect(floorMaterial(binding())).toEqual({color:'#ffffff',roughness:1,metalness:0});expect(floorPresetDefaults('marble').repeatMeters).toEqual([1,1]);
 });
});
