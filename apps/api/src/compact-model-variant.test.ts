// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {float32BoundsEqual,qualifyApprovedCompactGeometryPair,qualifyApprovedNearGeometryPair} from './approved-lod-pair.ts';
import {modelPreparationIntent,createCompactVariantReceipt,compactVariantReceipt,modelPreparationView,modelReceiptDigest} from './model-preparation-intent.ts';
import {COMPACT_MODEL_RECIPE,COMPACT_MODEL_RECIPE_SHA256,modelPreparationHash,type CompactModelReceipt} from './oam-original-preparation.ts';
import {prepareCompactModelInWorker} from './oam-original-preparation-process.ts';
const sourceId='11111111-1111-4111-8111-111111111111',coarseId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333';
it('compares declared FLOAT bounds by component semantics without accepting adjacent floats',()=>{
 const actual=[-111.30490112304688,-138.04620361328125,-66.48719787597656];
 expect(float32BoundsEqual([-111.304901123047,-138.046203613281,-66.4871978759766],actual)).toBe(true);
 expect(float32BoundsEqual([-111.30491,...actual.slice(1)],actual)).toBe(false);
 expect(float32BoundsEqual([NaN,actual[1],actual[2]],actual)).toBe(false);
 expect(float32BoundsEqual(actual.slice(1),actual)).toBe(false);
});
it('binds sourceFull and coarse separately and never exposes the full as acquired original',()=>{
 const request=modelPreparationIntent({version:1,profileId:COMPACT_MODEL_RECIPE.id,operationID:jobId,generation:'durable-1',artworkRevision:1,sourceFull:{assetId:sourceId,approvalSHA256:'d'.repeat(64)}})!;
 const row={tenant_id:'owner',id:jobId,artwork_id:sourceId,idempotency_key:jobId,mime:'model/gltf-binary',expected_hash:'a'.repeat(64),expected_bytes:16036864,rights:{display:true},png_drain_version:1,png_worker_tokens:[],lease_id:null,state:'processing',model_preparation:{kind:'required-model-compact',request}};
 const producer={version:1,recipeId:COMPACT_MODEL_RECIPE.id,recipeSHA256:COMPACT_MODEL_RECIPE_SHA256,source:{sha256:row.expected_hash,bytes:row.expected_bytes,triangles:100000,vertices:86202,bounds:{min:[0,0,0],max:[1,1,1]}},output:{sha256:'b'.repeat(64),bytes:1874704,triangles:20000,vertices:14734,textureEdge:512,bounds:{min:[0,0,0],max:[1,1,1]},reusedOriginal:false},images:[],simplifier:{version:'1.1.1',relativeAppearanceError:.01,lockedVertices:8},decoder:COMPACT_MODEL_RECIPE.decoder} as CompactModelReceipt;
 const receipt=createCompactVariantReceipt(row,coarseId,producer),ready={...row,state:'approved',asset_id:coarseId,original_asset_id:sourceId,model_preparation:{...row.model_preparation,result:receipt}};
 expect(compactVariantReceipt(ready)).toEqual(receipt);const view=modelPreparationView(ready);expect(view).toMatchObject({purpose:'approved-full-compact',status:'ready',sourceFull:{assetId:sourceId},coarse:{assetId:coarseId}});expect(view).not.toHaveProperty('original');expect(view).not.toHaveProperty('display');
 const pending=modelPreparationView({...ready,png_worker_tokens:[jobId]});expect(pending).not.toHaveProperty('coarse');expect(pending).not.toHaveProperty('serverReceipt');
 expect(()=>compactVariantReceipt({...ready,model_preparation:{...ready.model_preparation,result:{...receipt,producer:{...producer,source:{...producer.source,sha256:'c'.repeat(64)}}}}})).toThrow();
 expect(()=>modelPreparationIntent({...request,sourceFull:{...request.sourceFull,untrusted:true}})).toThrow();
 const {sha256,...body}=receipt;expect(modelReceiptDigest(body)).toBe(sha256);
});
const actualSource=process.env.EXHIBITOS_COMPACT_VARIANT_SOURCE,evidence=process.env.EXHIBITOS_COMPACT_VARIANT_EVIDENCE;
it.skipIf(!actualSource||!evidence)('qualifies one actual supported-product compact result without changing source bytes',async()=>{
 const full=await readFile(actualSource!);expect(modelPreparationHash(full)).toBe('694a9cf81dfbf12fd0841ae45240c5ae0f1d7cb129d0ee122be7cff86c4625bc');expect(full.length).toBe(16036864);
 // Earlier diagnostic retained only its receipt. This one changed-qualifier
 // component run preserves bytes before any reader assertion; no native intake.
 const retained=process.env.EXHIBITOS_COMPACT_VARIANT_RETAINED;
 const output=retained?{...JSON.parse(await readFile(join(retained,'producer.json'),'utf8')),bytes:await readFile(join(retained,'candidate.glb'))}:await prepareCompactModelInWorker(full,{bytes:full.length,sha256:modelPreparationHash(full)});
 if(!retained){await writeFile(join(evidence!,'candidate.glb'),output.bytes,{flag:'wx'});await writeFile(join(evidence!,'producer.json'),JSON.stringify({...output,bytes:undefined},null,2)+'\n',{flag:'wx'});}
 const declaration={fullTriangles:100000,coarseTriangles:20000,fullTextureSize:2048,reducedTextureSize:512};
 expect(()=>qualifyApprovedNearGeometryPair(full,output.bytes,declaration)).toThrow();
 expect(qualifyApprovedCompactGeometryPair(full,output.bytes,declaration)).toMatchObject({full:{triangles:100000,textureSize:2048},coarse:{triangles:20000,textureSize:512}});
 expect(modelPreparationHash(await readFile(actualSource!))).toBe(modelPreparationHash(full));expect(output.workerDrained).toBe(true);
},30000);
