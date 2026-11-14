// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {BUDGET_GEOMETRY_PAIR_PROFILE,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import {expect,it} from 'vitest';
import {DEVICE_BUDGETS} from './viewer/loading';
import {nativeOrdinaryInventory,nativeScenePressurePreferences,qualifiedNativeModelPair,type NativeLoadedModel} from './native-ordinary-scene-variants';

async function fixture(){
 const doc=structuredClone((await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex')))).exhibition);if(doc.schemaVersion!=='1.0.0-draft.1')throw Error('SYNTHETIC_FIXTURE_VERSION');
 const art=doc.artworks.find(a=>a.artworkType==='sculpture')!,full=art.assets.find(a=>a.id===art.primaryAssetId)!,coarse={...full,id:crypto.randomUUID(),bytes:1874704,sha256:'b'.repeat(64)};
 full.bytes=16036864;coarse.path=`assets/${coarse.id}/model.glb`;art.assets=[full,coarse];art.extensions={...art.extensions,[LOD_NAMESPACE]:{version:1,profile:BUDGET_GEOMETRY_PAIR_PROFILE,variants:[{assetId:full.id,detail:'full',triangles:100000,textureSize:2048},{assetId:coarse.id,detail:'coarse',triangles:20000,textureSize:512}]}};
 doc.artworks=[art];const loaded=new Map<string,NativeLoadedModel>([[art.revisionId,{revisionId:art.revisionId,assetId:full.id,triangles:100000,placements:1}]]);
 return {doc,art,full,coarse,loaded};
}
it('keeps the highest eligible declared tier and only honors a current qualified pressure preference',async()=>{
 const f=await fixture();expect(qualifiedNativeModelPair(f.art)).toBe(true);expect(nativeOrdinaryInventory(f.art,DEVICE_BUDGETS.desktop).id).toBe(f.full.id);
 expect(nativeOrdinaryInventory(f.art,DEVICE_BUDGETS.compact).id).toBe(f.coarse.id);expect(nativeOrdinaryInventory(f.art,DEVICE_BUDGETS.desktop,f.coarse.id).id).toBe(f.coarse.id);
 expect(()=>nativeOrdinaryInventory(f.art,DEVICE_BUDGETS.desktop,crypto.randomUUID())).toThrow('VARIANT_REFERENCE');
 delete f.art.extensions![LOD_NAMESPACE];expect(nativeOrdinaryInventory(f.art,DEVICE_BUDGETS.desktop).id).toBe(f.full.id);expect(()=>nativeOrdinaryInventory(f.art,DEVICE_BUDGETS.desktop,f.coarse.id)).toThrow('VARIANT_REFERENCE');
});
it.each([{missingTriangles:0,missingDraws:-24},{missingTriangles:-1,missingDraws:0},{missingTriangles:9705,missingDraws:1},{missingTriangles:NaN,missingDraws:0}])('does not lower quality without eligible triangle-only pressure %j',async pressure=>{
 const f=await fixture();expect(nativeScenePressurePreferences(f.doc,DEVICE_BUDGETS.desktop,f.loaded,pressure)).toBeUndefined();
});
it('plans an already approved coarse asset only after measured pressure, without modifying the graph or caps',async()=>{
 const f=await fixture(),before=JSON.stringify(f.doc),budget={...DEVICE_BUDGETS.desktop},copy={...budget},plan=nativeScenePressurePreferences(f.doc,budget,f.loaded,{missingTriangles:9705,missingDraws:-24});
 expect([...plan!]).toEqual([[f.art.revisionId,f.coarse.id]]);expect(JSON.stringify(f.doc)).toBe(before);expect(budget).toEqual(copy);
});
it('requires a conservative saving including two passes and every repeated placement',async()=>{
 const f=await fixture();f.loaded.get(f.art.revisionId)!.triangles=30000;
 expect(nativeScenePressurePreferences(f.doc,DEVICE_BUDGETS.desktop,f.loaded,{missingTriangles:1000,missingDraws:0})).toBeUndefined();
 f.loaded.get(f.art.revisionId)!.triangles=200000;f.loaded.get(f.art.revisionId)!.placements=2;
 expect(nativeScenePressurePreferences(f.doc,DEVICE_BUDGETS.desktop,f.loaded,{missingTriangles:120000,missingDraws:0})?.get(f.art.revisionId)).toBe(f.coarse.id);
 expect(nativeScenePressurePreferences(f.doc,DEVICE_BUDGETS.desktop,f.loaded,{missingTriangles:120001,missingDraws:0})).toBeUndefined();
});
it('does not repeatedly replan already reduced or unknown loaded assets',async()=>{
 const f=await fixture();f.loaded.get(f.art.revisionId)!.assetId=f.coarse.id;
 expect(nativeScenePressurePreferences(f.doc,DEVICE_BUDGETS.desktop,f.loaded,{missingTriangles:9705,missingDraws:0})).toBeUndefined();
 f.loaded.get(f.art.revisionId)!.assetId=crypto.randomUUID();expect(nativeScenePressurePreferences(f.doc,DEVICE_BUDGETS.desktop,f.loaded,{missingTriangles:9705,missingDraws:0})).toBeUndefined();
});
it('changes only the fewest declared models needed instead of blanket-forcing every coarse tier',async()=>{
 const f=await fixture(),other=structuredClone(f.doc.artworks[0]!);other.id=crypto.randomUUID();other.revisionId=crypto.randomUUID();f.doc.artworks.push(other);f.loaded.set(other.revisionId,{revisionId:other.revisionId,assetId:other.primaryAssetId,triangles:100000,placements:1});
 expect(nativeScenePressurePreferences(f.doc,DEVICE_BUDGETS.desktop,f.loaded,{missingTriangles:1000,missingDraws:0})?.size).toBe(1);
 expect(nativeScenePressurePreferences(f.doc,DEVICE_BUDGETS.desktop,f.loaded,{missingTriangles:61000,missingDraws:0})?.size).toBe(2);
});
