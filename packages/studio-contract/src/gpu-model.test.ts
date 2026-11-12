// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {GPU_MODEL_NAMESPACE,GPU_MODEL_PROFILE,GPU_MODEL_RECIPE_SHA256,artworkGpuModelFor,validateArtworkGpuModel} from './gpu-model.js';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){return {artworkType:'sculpture',primaryAssetId:id(1),assets:[1,2,3].map(n=>({id:id(n),path:`assets/${id(n)}/model.glb`,role:'model',mime:'model/gltf-binary',bytes:32,sha256:String(n).repeat(64)})),extensions:{[GPU_MODEL_NAMESPACE]:{version:1,profile:GPU_MODEL_PROFILE,recipeSHA256:GPU_MODEL_RECIPE_SHA256,receiptSHA256:'a'.repeat(64),sourceAssetId:id(1),candidateAssetId:id(2),triangles:200000,textureSize:512},'org.exhibitos.viewer/lod':{version:1,variants:[{assetId:id(3),detail:'coarse'}]}}};}
it('selects a distinct encoding while preserving source primary and independent LOD',()=>{
 const artwork=fixture(),before=structuredClone(artwork);expect(validateArtworkGpuModel(artwork)).toEqual({valid:true,errors:[]});const selection=artworkGpuModelFor(artwork)!;expect(selection.source.id).toBe(id(1));expect(selection.candidate.id).toBe(id(2));expect(selection.binding.triangles).toBe(200000);expect(artwork).toEqual(before);
});
it('admits missing legacy metadata without selecting an encoding or inferring authority',()=>{
 for(const artwork of [undefined,{}, {assets:fixture().assets}, {extensions:{}}]){expect(validateArtworkGpuModel(artwork).valid).toBe(true);expect(artworkGpuModelFor(artwork)).toBeUndefined();}
});
it('rejects unrecognized metadata, nonfinite/over-limit metrics, aliases, untyped or missing candidates',()=>{
 const changes:((v:ReturnType<typeof fixture>)=>void)[]=[
 v=>{Object.assign(v.extensions[GPU_MODEL_NAMESPACE],{unknown:true});},v=>{v.extensions[GPU_MODEL_NAMESPACE]!.version=2;},v=>{v.extensions[GPU_MODEL_NAMESPACE]!.profile='future-profile';},v=>{v.extensions[GPU_MODEL_NAMESPACE]!.recipeSHA256='0'.repeat(64);},v=>{v.extensions[GPU_MODEL_NAMESPACE]!.receiptSHA256='A'.repeat(64);},
 ...[0,-1,1.5,NaN,Infinity,200001].map(n=>(v:ReturnType<typeof fixture>)=>{v.extensions[GPU_MODEL_NAMESPACE]!.triangles=n;}),v=>{v.extensions[GPU_MODEL_NAMESPACE]!.textureSize=256;},v=>{v.extensions[GPU_MODEL_NAMESPACE]!.candidateAssetId=id(1);},v=>{v.primaryAssetId=id(3);},v=>{v.artworkType='image';},v=>{v.assets.pop();v.assets.pop();},v=>{v.assets.push({...v.assets[1]!});},v=>{v.assets[1]!.role='preview';},v=>{v.assets[1]!.mime='image/png';},v=>{v.assets[1]!.bytes=33554433;},v=>{v.assets[0]!.bytes=33554433;},v=>{v.assets[1]!.sha256='unverified';},v=>{Object.defineProperty(v.extensions[GPU_MODEL_NAMESPACE]!,'triangles',{get:()=>1});},v=>{Object.defineProperty(v.extensions[GPU_MODEL_NAMESPACE]!,Symbol('untrusted'),{value:1});},
 ];
 for(const mutate of changes){const artwork=fixture();mutate(artwork);expect(validateArtworkGpuModel(artwork).valid).toBe(false);expect(artworkGpuModelFor(artwork)).toBeUndefined();}
});
