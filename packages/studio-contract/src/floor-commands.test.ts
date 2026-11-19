// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {FOOTSTEP_RESOURCE_NAMESPACE,footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {recordedFloorScopes} from './footstep-bank.js';
import {EXPERIENCE_NAMESPACE,experienceFor,validateViewerExperience} from './experience.js';
import {applyRecordedFloorCommand,applyFloorPreset,createFloorPreset,resetFloorFields} from './floor-commands.js';
import {validateStudioMaterials} from './index.js';
import {FLOOR_NAMESPACE,floorFor,floorMaterial,type FloorBinding} from './floors.js';
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


describe('ordinary whole material and recorded reset',()=>{
 const roomId=target.roomId;
 const doc=()=>({rooms:[{id:roomId,name:'Gallery'}],surfaces:[],mediaAssets:[],extensions:{}} as unknown as Exhibition);
 const select=(d:Exhibition,preset:'wood'|'tile'|'marble')=>applyRecordedFloorCommand(d,{type:'select-floor-material',target,preset});
 const reset=(d:Exhibition)=>applyRecordedFloorCommand(d,{type:'reset-floor-sound',target});
 const floor=(d:Exhibition)=>floorFor(d,{roomId})!;
 it('declares the matching exact bank on first use and a whole material change',()=>{
  const source=doc(),wood=select(source,'wood');
  const woodBinding=(wood.extensions![FLOOR_NAMESPACE] as unknown as {bindings:FloorBinding[]}).bindings[0]!;
  woodBinding.sound={mode:'material-default',gain:.35};
  const tile=select(wood,'tile');
  expect(source.extensions).toEqual({});
  expect(floor(tile)).toMatchObject({preset:'tile',texturePack:{id:'Tiles074'},sound:{mode:'material-default',gain:.35}});
  expect(recordedFloorScopes(tile)[0]!.sound).toMatchObject({kind:'builtin',material:'tile'});
  expect(footstepResourcesFor(tile).filter(item=>item.family==='tile'&&item.role==='sample')).toHaveLength(2);
  expect(footstepResourcesFor(tile).filter(item=>item.role==='notice')).toHaveLength(2);
 });
 it.each(['none','explicit'] as const)('preserves %s on selecting a new material, and reset uses that material',mode=>{
  const source=select(doc(),'wood'),id='22222222-2222-4222-8222-222222222222';
  const binding=(source.extensions![FLOOR_NAMESPACE] as unknown as {bindings:FloorBinding[]}).bindings[0]!;
  source.mediaAssets.push({id,mime:'audio/wav'} as Exhibition['mediaAssets'][number]);
  binding.sound=mode==='explicit'?{mode,gain:.25,assetIds:[id]}:{mode,gain:.25};
  const next=select(source,'marble');
  expect(floor(next).sound).toEqual(binding.sound);
  expect(next.extensions![FOOTSTEP_RESOURCE_NAMESPACE]).toEqual({version:1,families:['wood']});
  expect(recordedFloorScopes(reset(next))[0]!.sound).toMatchObject({kind:'builtin',material:'marble',gain:1});
 });
 it('reset follows the actual stock appearance after a visual-only edit and keeps the visual fields',()=>{
  const source=select(doc(),'wood');
  const bindings=(source.extensions![FLOOR_NAMESPACE] as unknown as {bindings:FloorBinding[]}).bindings;
  bindings[0]=applyFloorPreset(bindings[0]!,'tile',['texturePack','repeatMeters','rotation']);
  const prior=floor(source), next=reset(source);
  expect(floor(next)).toMatchObject({preset:'tile',texturePack:prior.texturePack,repeatMeters:prior.repeatMeters,rotation:prior.rotation});
  expect(recordedFloorScopes(next)[0]!.sound).toMatchObject({kind:'builtin',material:'tile'});
 });
 it('keeps legacy PBR on reset when its stored surface reference has different casing',()=>{
  const source=doc(),surfaceId='abcdef12-3333-4333-8333-333333333333';
  source.surfaces.push({id:surfaceId,roomId,type:'floor'} as Exhibition['surfaces'][number]);
  const target={kind:'surface' as const,surfaceId};
  const binding=applyFloorPreset(createFloorPreset(target,'wood'),'tile',['texturePack']);
  delete binding.materialOverride;
  const material={color:'#123456',roughness:.4,metalness:.2};
  source.extensions={[FLOOR_NAMESPACE]:{version:1,bindings:[binding]},
   'org.exhibitos.studio/materials':{version:1,surfaces:{[surfaceId.toUpperCase()]:material}}};
  expect(validateStudioMaterials(source).valid).toBe(true);
  const next=applyRecordedFloorCommand(source,{type:'reset-floor-sound',target});
  expect(floorFor(next,{roomId,surfaceId})).toMatchObject({preset:'tile',materialOverride:material});
  expect(next.extensions!['org.exhibitos.studio/materials']).toEqual(source.extensions!['org.exhibitos.studio/materials']);
  expect(recordedFloorScopes(next)[0]!.sound).toMatchObject({kind:'builtin',material:'tile'});
 });
 it('does not infer sound on a custom map or treat a dormant room base as active',()=>{
  const source=select(doc(),'wood'),surfaceId='abcdef12-3333-4333-8333-333333333333';
  source.surfaces.push({id:surfaceId,roomId,type:'floor'} as Exhibition['surfaces'][number]);
  source.extensions!['org.exhibitos.studio/workspace-materials']={version:1,bindings:[{surfaceId:surfaceId.toUpperCase()}],materials:[]};
  expect(recordedFloorScopes(source)[0]!.sound.kind).toBe('unassigned');
  expect(()=>reset(source)).toThrow('FLOOR_TARGET_INVALID');
  expect(()=>applyRecordedFloorCommand(source,{type:'select-floor-material',target:{kind:'surface',surfaceId},preset:'tile'})).toThrow('FLOOR_RECORDING_UNASSIGNED');
  const experience={...experienceFor(source),footsteps:[{surfaceId,material:'wood' as const}]};
  source.extensions![EXPERIENCE_NAMESPACE]=experience as unknown as NonNullable<Exhibition['extensions']>[string];
  expect(recordedFloorScopes(source)[0]!.sound.kind).toBe('builtin');
  const resetCustom=applyRecordedFloorCommand(source,{type:'reset-floor-sound',target:{kind:'surface',surfaceId}});
  expect(recordedFloorScopes(resetCustom)[0]!.sound.kind).toBe('unassigned');
  expect(resetCustom.extensions!['org.exhibitos.studio/workspace-materials']).toEqual(source.extensions!['org.exhibitos.studio/workspace-materials']);
  expect(experienceFor(source).footsteps).toEqual(experience.footsteps);
 });
 it('preserves an explicit experience recording on material choice and resets only that floor override',()=>{
  const source=doc(),surfaceId='abcdef12-3333-4333-8333-333333333333',assetId='22222222-2222-4222-8222-222222222222';
  source.surfaces.push({id:surfaceId,roomId,type:'floor'} as Exhibition['surfaces'][number]);
  const alias=surfaceId.toUpperCase();
  source.mediaAssets.push({id:assetId,mime:'audio/wav'} as Exhibition['mediaAssets'][number]);
  const experience={...experienceFor(source),footsteps:[{surfaceId:alias,assetId,material:'stone' as const}]};
  source.extensions![EXPERIENCE_NAMESPACE]=experience as unknown as NonNullable<Exhibition['extensions']>[string];
  expect(validateViewerExperience(source).valid).toBe(true);
  const surface={kind:'surface' as const,surfaceId:alias};
  const selected=applyRecordedFloorCommand(source,{type:'select-floor-material',target:surface,preset:'wood'});
  expect(selected.extensions![EXPERIENCE_NAMESPACE]).toEqual(experience);
  expect(recordedFloorScopes(selected)[0]!.sound).toMatchObject({kind:'publication',ids:[assetId],material:'stone'});
  const restored=applyRecordedFloorCommand(selected,{type:'reset-floor-sound',target:surface});
  expect(restored.extensions![EXPERIENCE_NAMESPACE]).toEqual({...experience,footsteps:[{surfaceId:alias,material:'stone'}]});
  expect(restored.mediaAssets).toEqual(source.mediaAssets);
  expect(selected.extensions![EXPERIENCE_NAMESPACE]).toEqual(experience);
  expect(recordedFloorScopes(restored)[0]!.sound).toMatchObject({kind:'builtin',material:'wood'});
 });
});
