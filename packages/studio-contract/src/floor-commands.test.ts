// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {applyFloorPreset,createFloorPreset,resetFloorFields} from './floor-commands.js';
import {floorMaterial,type FloorBinding} from './floors.js';
const target={kind:'room-base' as const,roomId:'11111111-1111-4111-8111-111111111111'};
describe('explicit floor preset scopes',()=>{
 it('creates a whole uncustomized preset with appearance and authored default sound',()=>{
  const b=createFloorPreset(target,'wood');expect(b.target).toEqual(target);expect(b.sound).toEqual({mode:'material-default',gain:1});expect(b.texturePack).toEqual({id:'WoodFloor051',version:1});expect(b.repeatMeters).toEqual([1.8,1.8]);
 });
 it('keeps old default sound family while writing selected appearance overrides',()=>{
  const b=createFloorPreset(target,'wood'),before=structuredClone(b);b.sound={mode:'material-default',gain:.3};
  const next=applyFloorPreset(b,'marble',['texturePack','repeatMeters','color']);expect(next.preset).toBe('wood');expect(next.sound).toEqual(b.sound);expect(next.texturePack).toEqual({id:'Marble006',version:1});expect(next.repeatMeters).toEqual([1,1]);expect(b.texturePack).toEqual(before.texturePack);
 });
 it('does not silently change between tile and marble sounds on an appearance-only change',()=>{
  for(const [from,to] of [['tile','marble'],['marble','tile']] as const){
   const b=createFloorPreset(target,from),next=applyFloorPreset(b,to,['texturePack']);
   expect(next.preset).toBe(from);expect(next.sound).toEqual(b.sound);
   expect(next.texturePack).toEqual({id:to==='tile'?'Tiles074':'Marble006',version:1});
  }
 });
 it('materializes inherited unselected appearance on a base change without altering legacy sound absence',()=>{
  const b:FloorBinding={target,preset:'tile',repeatMeters:[2.1,2.1],rotation:.2};
  const next=applyFloorPreset(b,'marble',['repeatMeters'],{color:'#123456',roughness:.4,metalness:.2});expect(next.preset).toBe('marble');expect(next.sound).toBeUndefined();expect(next.texturePack).toEqual({id:'Tiles074',version:1});expect(next.rotation).toBe(.2);expect(next.normalScale).toBe(1);expect(next.aoStrength).toBe(1);expect(next.materialOverride).toEqual({color:'#123456',roughness:.4,metalness:.2});
 });
 it('sound-only accepted family changes retain all prior effective appearance',()=>{
  const b:FloorBinding={target,preset:'wood',repeatMeters:[1.8,1.8],rotation:0,sound:{mode:'explicit',gain:.2,assetIds:['22222222-2222-4222-8222-222222222222']}};
  const legacy={color:'#123456',roughness:.4,metalness:.2},next=applyFloorPreset(b,'carpet',['sound'],legacy);expect(next.preset).toBe('carpet');expect(next.sound).toEqual({mode:'material-default',gain:1});expect(next.texturePack).toEqual({id:'WoodFloor051',version:1});expect(floorMaterial(next,legacy)).toEqual(floorMaterial(b,legacy));
 });
 it('reset writes persisted preset defaults rather than revealing old legacy assignments',()=>{
  const b=createFloorPreset(target,'wood');b.materialOverride={color:'#111111',roughness:0};b.sound={mode:'none',gain:.4};
  const next=resetFloorFields(b,['color']);expect(next.materialOverride).toEqual({color:'#ffffff',roughness:0});expect(next.sound).toEqual(b.sound);expect(next.preset).toBe('wood');
  expect(()=>applyFloorPreset(b,'tile',['sound','sound'])).toThrow('FLOOR_APPLY_SCOPE');
 });
});
