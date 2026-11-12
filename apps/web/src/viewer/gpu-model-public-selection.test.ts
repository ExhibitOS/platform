// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import type {Artwork} from '@exhibitos/spec';
import {GPU_MODEL_NAMESPACE,GPU_MODEL_PROFILE,GPU_MODEL_RECIPE_SHA256,LOD_NAMESPACE,BUDGET_GEOMETRY_PAIR_PROFILE} from '@exhibitos/studio-contract';
import {AssetReleaseUnconfirmedError,modelDecodeReserve,selectAssetVariant,type DeviceBudget} from './loading';
import {createEntranceReadiness} from './entrance-readiness';
import {logicalSourceAssetId,resolveDisplayRepresentation,sourceVariantForInventory} from './gpu-model-representation';
import {fallbackPublicGpuAsset,publicDisplayDecodeReserve,publicGpuCandidate,retirePublicGpuProbeRenderer} from './gpu-model-public-selection';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const budget:DeviceBudget={concurrency:2,maxPixelRatio:1,maxTriangles:20000,maxTextureSize:512,maxCacheBytes:32*1024*1024,maxTransitionBytes:64*1024*1024,entranceAssets:4};
const caps={astcSupported:true,bptcSupported:false};
function fixture(){
 const assets=[1,2,3].map(n=>({id:id(n),path:`assets/${id(n)}/model.glb`,role:'model' as const,mime:'model/gltf-binary' as const,bytes:n===1?10000:n===2?2000:1000,sha256:String(n).repeat(64)}));
 return {revisionId:id(10),artworkType:'sculpture',primaryAssetId:id(1),assets,extensions:{
  [GPU_MODEL_NAMESPACE]:{version:1,profile:GPU_MODEL_PROFILE,recipeSHA256:GPU_MODEL_RECIPE_SHA256,receiptSHA256:'a'.repeat(64),sourceAssetId:id(1),candidateAssetId:id(2),triangles:12000,textureSize:512},
  [LOD_NAMESPACE]:{version:1,profile:BUDGET_GEOMETRY_PAIR_PROFILE,variants:[{assetId:id(1),detail:'full',triangles:15000,textureSize:512},{assetId:id(3),detail:'coarse',triangles:1000,textureSize:256}]},
 }} as unknown as Artwork;
}
function header(edge:number){
 const bin=new Uint8Array(72),v=new DataView(bin.buffer);bin.set([137,80,78,71,13,10,26,10],36);v.setUint32(52,edge);v.setUint32(56,edge);bin[60]=8;bin[61]=2;
 const doc={buffers:[{byteLength:72}],bufferViews:[{buffer:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36}],accessors:[{bufferView:0,count:3,type:'VEC3',componentType:5126}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],images:[{bufferView:1,mimeType:'image/png'}],textures:[{source:0}]};
 const json=new TextEncoder().encode(JSON.stringify(doc)),length=Math.ceil(json.length/4)*4,result=new Uint8Array(28+length+bin.length),view=new DataView(result.buffer);
 view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,result.length,true);view.setUint32(12,length,true);view.setUint32(16,0x4e4f534a,true);result.fill(32,20,20+length);result.set(json,20);view.setUint32(20+length,bin.length,true);view.setUint32(24+length,0x004e4942,true);result.set(bin,28+length);return result.buffer;
}
test('ordinary tier is selected first; actual candidate keys retain full semantics and original primary',()=>{
 const art=fixture(),failed=new Set<string>(),ordinary=selectAssetVariant(art,0,budget),actual=resolveDisplayRepresentation(art,ordinary,budget,caps,failed,true).inventory;
 expect(ordinary.id).toBe(id(1));expect(actual.id).toBe(id(2));expect(art.primaryAssetId).toBe(id(1));
 const prepared=new Map([[actual.id,'actual GPU object']]);expect(prepared.get(actual.id)).toBeDefined();expect(prepared.get(ordinary.id)).toBeUndefined();
 expect(logicalSourceAssetId(art,actual.id)).toBe(ordinary.id);expect(sourceVariantForInventory(art,actual.id)).toMatchObject({assetId:ordinary.id,detail:'full',triangles:12000});
 const coarse=selectAssetVariant(art,Infinity,budget,true);expect(resolveDisplayRepresentation(art,coarse,budget,caps,failed,true).inventory).toBe(coarse);
});
test('clean fallback retires only the failed representation and resets exact required entrance identity',()=>{
 const art=fixture(),source=art.assets[0]!,candidate=art.assets[1]!,peer=art.assets[2]!,failed=new Set<string>(),entrance=new Map([[art.revisionId,candidate],['peer',peer]]),required=vi.fn();
 const result=fallbackPublicGpuAsset(art,candidate,Error('GPU_MODEL_TEXTURE_FORMAT'),false,failed,entrance,required);
 expect(result).toBe(source);expect(failed).toEqual(new Set([candidate.id]));expect(entrance.get(art.revisionId)).toBe(source);expect(entrance.get('peer')).toBe(peer);expect(required).toHaveBeenCalledExactlyOnceWith([source,peer]);
 expect(resolveDisplayRepresentation(art,source,budget,caps,failed,true).inventory).toBe(source);
 expect(resolveDisplayRepresentation(art,source,budget,caps,new Set(),true).inventory).toBe(candidate);
});
test.each([new DOMException('cancelled','AbortError'),new AssetReleaseUnconfirmedError()])('cancel/unconfirmed cleanup never changes failed IDs or entrance (%s)',error=>{
 const art=fixture(),candidate=art.assets[1]!,failed=new Set<string>(),entrance=new Map([[art.revisionId,candidate]]),required=vi.fn();
 expect(fallbackPublicGpuAsset(art,candidate,error,false,failed,entrance,required)).toBeUndefined();expect(failed.size).toBe(0);expect(entrance.get(art.revisionId)).toBe(candidate);expect(required).not.toHaveBeenCalled();
});
test('abort signal, ordinary source and malformed carrier cannot be reinterpreted as candidate failure',()=>{
 const art=fixture(),candidate=art.assets[1]!,failed=new Set<string>(),entrance=new Map([[art.revisionId,candidate]]),required=vi.fn();
 for(const [inventory,aborted]of [[candidate,true],[art.assets[0]!,false]] as const)expect(fallbackPublicGpuAsset(art,inventory,Error('CLEAN'),aborted,failed,entrance,required)).toBeUndefined();
 expect(publicGpuCandidate(art,{...candidate,sha256:'f'.repeat(64)})).toBeUndefined();delete art.extensions![GPU_MODEL_NAMESPACE];expect(fallbackPublicGpuAsset(art,candidate,Error('CLEAN'),false,failed,entrance,required)).toBeUndefined();expect(failed.size).toBe(0);expect(required).not.toHaveBeenCalled();
});
test('fallback of a nonrequired candidate does not introduce false required peers',()=>{
 const art=fixture(),candidate=art.assets[1]!,peer=art.assets[2]!,entrance=new Map([['peer',peer]]),required=vi.fn();
 expect(fallbackPublicGpuAsset(art,candidate,Error('CLEAN'),false,new Set(),entrance,required)).toBe(art.assets[0]);expect([...entrance]).toEqual([['peer',peer]]);expect(required).not.toHaveBeenCalled();
});
test('decode arithmetic retains physical bytes and tightens to logical source/binding texture ceiling',()=>{
 const art=fixture(),candidate=art.assets[1]!,bytes=header(512);candidate.bytes=bytes.byteLength;
 const larger={...budget,maxTextureSize:2048};
 expect(publicDisplayDecodeReserve(art,candidate,larger,bytes,'cpu')).toBe(modelDecodeReserve(candidate.bytes,larger,bytes,512,'cpu'));
 expect(publicDisplayDecodeReserve(art,candidate,larger,bytes,'cpu')).not.toBe(modelDecodeReserve(art.assets[0]!.bytes,larger,bytes,512,'cpu'));
 expect(()=>publicDisplayDecodeReserve(art,candidate,larger,header(1024),'cpu')).toThrow('DECODE_BUDGET_EXCEEDED');
});
test('borrowed promotion recomputes the actual target after same logical full fallback',()=>{
 const art=fixture(),failed=new Set<string>(),full=selectAssetVariant(art,0,budget);
 const target=()=>resolveDisplayRepresentation(art,full,budget,caps,failed,true).inventory;
 expect(target().id).toBe(id(2));fallbackPublicGpuAsset(art,target(),Error('CLEAN'),false,failed,new Map(),()=>{});
 const prepared=new Map([[id(1),'source full']]);expect(target().id).toBe(id(1));expect(prepared.get(target().id)).toBe('source full');expect(logicalSourceAssetId(art,id(2))).toBe(target().id);
});

test('real entrance ledger drops the failed GPU requirement and completes only after source bytes arrive',()=>{
 const art=fixture(),candidate=art.assets[1]!,source=art.assets[0]!,entry=createEntranceReadiness(100),entrance=new Map([[art.revisionId,candidate]]);
 entry.setCover(null);entry.setRequiredAssets([candidate]);entry.receive(candidate,candidate.bytes);
 fallbackPublicGpuAsset(art,candidate,Error('CLEAN'),false,new Set(),entrance,assets=>entry.setRequiredAssets(assets));
 expect(entry.snapshot()).toEqual({receivedBytes:100,requiredBytes:100+source.bytes});entry.receive(source,source.bytes);expect(entry.snapshot()).toEqual({receivedBytes:100+source.bytes,requiredBytes:100+source.bytes});
});

test('source replacement waits for its capability-probe build and both renderer releases before successor admission',async()=>{
 let settle!:()=>void;const built=new Promise<void>(resolve=>{settle=resolve;}),events:string[]=[];
 const retired=retirePublicGpuProbeRenderer({dispose:()=>{events.push('dispose');},forceContextLoss:()=>{events.push('force-loss');}},built,async()=>{events.push('fence');});
 const successor=retired.then(()=>{events.push('successor');});await Promise.resolve();expect(events).toEqual([]);settle();await successor;expect(events).toEqual(['fence','dispose','force-loss','successor']);
});
test.each(['dispose','force-loss'] as const)('unknown %s cleanup still attempts both releases and blocks successor',async failing=>{
 const events:string[]=[],retired=retirePublicGpuProbeRenderer({dispose(){events.push('dispose');if(failing==='dispose')throw undefined;},forceContextLoss(){events.push('force-loss');if(failing==='force-loss')throw false;}},Promise.resolve(),async()=>{});
 const admit=vi.fn();await expect(retired.then(admit)).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);expect(events).toEqual(['dispose','force-loss']);expect(admit).not.toHaveBeenCalled();
});
test('a pending initialization fence holds the old renderer and successor barrier',async()=>{
 let finish!:()=>void;const fence=new Promise<void>(resolve=>{finish=resolve;}),events:string[]=[];
 const retired=retirePublicGpuProbeRenderer({dispose:()=>{events.push('dispose');},forceContextLoss:()=>{events.push('force-loss');}},Promise.resolve(),async()=>{events.push('fence');await fence;});
 const successor=retired.then(()=>{events.push('successor');});await vi.waitFor(()=>expect(events).toEqual(['fence']));
 finish();await successor;expect(events).toEqual(['fence','dispose','force-loss','successor']);
});
test.each([['undefined',undefined],['false',false],['error',Error('FENCE_UNCONFIRMED')]] as const)('a rejected %s fence attempts both releases and refuses a successor',async(_name,error)=>{
 const events:string[]=[],admit=vi.fn();
 const retired=retirePublicGpuProbeRenderer({dispose:()=>{events.push('dispose');},forceContextLoss:()=>{events.push('force-loss');}},Promise.resolve(),async()=>{throw error;});
 await expect(retired.then(admit)).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);expect(events).toEqual(['dispose','force-loss']);expect(admit).not.toHaveBeenCalled();
});
