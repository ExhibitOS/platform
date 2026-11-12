// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import type {Artwork} from '@exhibitos/spec';
import {GPU_MODEL_NAMESPACE,GPU_MODEL_PROFILE,GPU_MODEL_RECIPE_SHA256,LOD_NAMESPACE,BUDGET_GEOMETRY_PAIR_PROFILE} from '@exhibitos/studio-contract';
import {logicalSourceAssetId,resolveDisplayRepresentation as resolve,sourceVariantForInventory} from './gpu-model-representation';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const astc={astcSupported:true,bptcSupported:false},bc7={astcSupported:false,bptcSupported:true};
const budget={maxTriangles:20000,maxTextureSize:512,maxCacheBytes:32*1024*1024,maxTransitionBytes:64*1024*1024};
function fixture(){
 const assets=[1,2,3].map(n=>({id:id(n),path:`assets/${id(n)}/model.glb`,role:'model' as const,mime:'model/gltf-binary' as const,bytes:n===1?2000000:n===2?2400000:100000,sha256:String(n).repeat(64)}));
 return {artworkType:'sculpture',primaryAssetId:id(1),assets,extensions:{
  [GPU_MODEL_NAMESPACE]:{version:1,profile:GPU_MODEL_PROFILE,recipeSHA256:GPU_MODEL_RECIPE_SHA256,receiptSHA256:'a'.repeat(64),sourceAssetId:id(1),candidateAssetId:id(2),triangles:20000,textureSize:512},
  [LOD_NAMESPACE]:{version:1,profile:BUDGET_GEOMETRY_PAIR_PROFILE,variants:[{assetId:id(1),detail:'full',triangles:20000,textureSize:512},{assetId:id(3),detail:'coarse',triangles:1000,textureSize:256}]},
 }} as unknown as Artwork;
}
const binding=(art:Artwork)=>art.extensions![GPU_MODEL_NAMESPACE] as {triangles:number;textureSize:number;recipeSHA256:string;receiptSHA256:string;candidateAssetId:string};
const variants=(art:Artwork)=>(art.extensions![LOD_NAMESPACE] as {variants:{assetId:string;detail:string;triangles:number;textureSize:number}[]}).variants;
test('selects actual ASTC or BC7 inventory while preserving original primary and full source identity',()=>{
 const art=fixture(),before=structuredClone(art),source=art.assets[0]!,candidate=art.assets[1]!;
 for(const [caps,targetFormat] of [[astc,'astc-4x4'],[bc7,'bc7'],[{astcSupported:true,bptcSupported:true},'astc-4x4']] as const){
  const result=resolve(art,source,budget,caps,new Set(),true);
  expect(result.inventory).toBe(candidate);expect(result.sourceInventory).toBe(source);expect(result.targetFormat).toBe(targetFormat);
  expect(result.inventory.id).not.toBe(result.sourceInventory.id);expect(result.sourceVariant).toMatchObject({assetId:source.id,detail:'full',triangles:20000,textureSize:512});
 }
 expect(art).toEqual(before);
});
test('private-disabled, filtered unsupported capabilities and failed candidate preserve ordinary source',()=>{
 const art=fixture(),source=art.assets[0]!;
 for(const [caps,failed,allow] of [[astc,new Set<string>(),false],[{astcSupported:false,bptcSupported:false},new Set<string>(),true],[astc,new Set([id(2).toUpperCase()]),true]] as const){
  expect(resolve(art,source,budget,caps,failed,allow)).toEqual({sourceInventory:source,inventory:source,sourceVariant:sourceVariantForInventory(art,source.id)});
 }
 const etcOnly={astcSupported:false,bptcSupported:false,etc2Supported:true};expect(resolve(art,source,budget,etcOnly,new Set(),true).inventory).toBe(source);
});
test('malformed, missing or unrelated binding cannot select candidate or infer a logical alias',()=>{
 const mutations:Array<(art:Artwork)=>void>=[
  art=>{delete art.extensions![GPU_MODEL_NAMESPACE];},art=>{binding(art).recipeSHA256='0'.repeat(64);},art=>{binding(art).receiptSHA256='unverified';},
  art=>{binding(art).candidateAssetId=id(1);},art=>{art.assets.splice(1,1);},art=>{binding(art).textureSize=2048;},art=>{Object.assign(binding(art),{unreviewed:true});},
 ];
 for(const mutate of mutations){const art=fixture();mutate(art);const source=art.assets[0]!;expect(resolve(art,source,budget,astc,new Set(),true).inventory).toBe(source);expect(logicalSourceAssetId(art,id(2))).toBe(id(2));}
});
test('coarse selection stays coarse; copied selector inventory resolves to the actual artwork object',()=>{
 const art=fixture(),coarse=art.assets[2]!,source=art.assets[0]!;
 const result=resolve(art,coarse,budget,astc,new Set(),true);expect(result.inventory).toBe(coarse);expect(result.sourceVariant).toMatchObject({assetId:coarse.id,detail:'coarse'});
 expect(logicalSourceAssetId(art,coarse.id)).toBe(coarse.id);expect(resolve(art,{...source},budget,astc,new Set(),true).sourceInventory).toBe(source);
 expect(()=>resolve(art,{...source,sha256:'0'.repeat(64)},budget,astc,new Set(),true)).toThrow('GPU_MODEL_SOURCE_INVENTORY_INVALID');
});
test('candidate and source LOD budgets remain independent and conservative with no encoded discount',()=>{
 for(const changed of [{...budget,maxTriangles:19999},{...budget,maxTextureSize:256},{...budget,maxCacheBytes:2399999},{...budget,maxTransitionBytes:9599999},{...budget,maxTransitionBytes:NaN}]){
  const art=fixture(),source=art.assets[0]!;expect(resolve(art,source,changed,astc,new Set(),true).inventory).toBe(source);
 }
 for(const metric of ['triangles','textureSize'] as const){
  const art=fixture(),source=art.assets[0]!;variants(art)[0]![metric]=metric==='triangles'?30000:2048;
  expect(resolve(art,source,budget,astc,new Set(),true).inventory).toBe(source);
 }
 const art=fixture(),source=art.assets[0]!;expect(resolve(art,source,{...budget,maxCacheBytes:2400000,maxTransitionBytes:9600000},astc,new Set(),true).inventory).toBe(art.assets[1]);
});
test('source variant mapping preserves logical detail and only tightens candidate admission ceilings',()=>{
 const art=fixture(),source=art.assets[0]!,candidate=art.assets[1]!;variants(art)[0]!.textureSize=2048;binding(art).triangles=19000;
 expect(logicalSourceAssetId(art,candidate.id.toUpperCase())).toBe(source.id);
 expect(sourceVariantForInventory(art,candidate.id)).toMatchObject({assetId:source.id,detail:'full',triangles:19000,textureSize:512});
 expect(sourceVariantForInventory(art,source.id)).toMatchObject({assetId:source.id,detail:'full',triangles:20000,textureSize:2048});
 binding(art).triangles=21000;expect(sourceVariantForInventory(art,candidate.id)?.triangles).toBe(20000);
 expect(logicalSourceAssetId(art,id(99))).toBe(id(99));expect(sourceVariantForInventory(art,id(99))).toBeUndefined();
});
