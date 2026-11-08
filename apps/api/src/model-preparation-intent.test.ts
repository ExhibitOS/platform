// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {COMPACT_MODEL_RECIPE,COMPACT_MODEL_RECIPE_SHA256,type CompactModelReceipt} from './oam-original-preparation.ts';
import {modelPreparationIntent,modelReceiptDigest,createModelPreparationReceipt,modelPreparationReceipt,modelPreparationView} from './model-preparation-intent.ts';
import {Imports} from './imports.ts';
import type {Pool} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
const intent={version:1 as const,profileId:COMPACT_MODEL_RECIPE.id,operationID:'operation-one',generation:'durable-generation',artworkRevision:1};
const producer:CompactModelReceipt={version:1,recipeId:COMPACT_MODEL_RECIPE.id,recipeSHA256:COMPACT_MODEL_RECIPE_SHA256,source:{sha256:'a'.repeat(64),bytes:1000,triangles:1,vertices:3,bounds:{min:[0,0,0],max:[1,1,0]}},output:{sha256:'b'.repeat(64),bytes:900,triangles:1,vertices:3,textureEdge:1,bounds:{min:[0,0,0],max:[1,1,0]},reusedOriginal:false},images:[],simplifier:{version:'1.1.1',relativeAppearanceError:0,lockedVertices:3},decoder:COMPACT_MODEL_RECIPE.decoder};
const row=()=>({id:'job',artwork_id:'artwork',user_id:'owner',tenant_id:'tenant',state:'processing',mime:'model/gltf-binary',derived:null,model_derivation:null,png_drain_version:1,png_worker_tokens:['lease'],lease_id:'lease',expected_hash:'a'.repeat(64),expected_bytes:1000,rights:{permissions:{display:true}},model_preparation:{kind:'required-model-compact',request:intent}} as Record<string,unknown>);
function ready(reuse=false){const r=row(),p=structuredClone(producer);if(reuse)p.output={...p.output,sha256:p.source.sha256,bytes:p.source.bytes,reusedOriginal:true};Object.assign(r,{state:'approved',asset_id:'display',original_asset_id:reuse?null:'original',lease_id:null,png_worker_tokens:[]});r.model_preparation={kind:'required-model-compact',request:intent,result:createModelPreparationReceipt(r,reuse?'display':'original','display',p)};return r;}
it('uses existing durable intent token semantics and a new draft revision without prior approval',()=>{
 expect(modelPreparationIntent(intent)).toEqual(intent);expect(modelPreparationIntent(undefined)).toBeUndefined();
 for(const change of [{generation:1},{generation:'a\nb'},{operationID:''},{artworkRevision:0},{profileId:'other'},{extra:true}])expect(()=>modelPreparationIntent({...intent,...change})).toThrow('INVALID_MODEL_PREPARATION');
});
it('withholds every output identity before actual drain and keeps required failure distinct',()=>{
 const imports=new Imports({} as Pool,{} as BlobStore);
 for(const state of ['uploading','queued','processing','failed','cancelled']){const r={...row(),state};const result=imports.view(r);expect(result.assetId).toBeUndefined();expect(result.modelPreparation).not.toHaveProperty('display');expect(result.modelPreparation).not.toHaveProperty('serverReceipt');expect(result.modelPreparation?.original).not.toHaveProperty('assetId');}
 const r=ready();r.png_worker_tokens=['old-worker'];const pending=imports.view(r);expect(pending.assetId).toBeUndefined();expect(pending.modelPreparation).toMatchObject({status:'processing',workerDrained:false});r.png_worker_tokens=[];expect(imports.view(r).modelPreparation).toMatchObject({status:'ready',workerDrained:true,display:{assetId:'display'},original:{assetId:'original'}});
});
it('reconstructs exact immutable producer, job, intent, rights and asset binding before returning ready',()=>{
 const r=ready(),receipt=modelPreparationReceipt(r);expect(receipt.display.assetId).toBe(r.asset_id);expect(modelReceiptDigest({b:2,a:[1.123456789,0]})).toBe(modelReceiptDigest({a:[1.123456789,0],b:2}));
 for(const mutate of [(x:Record<string,unknown>)=>{x.rights={permissions:{display:false}};},(x:Record<string,unknown>)=>{x.asset_id='alien';},(x:Record<string,unknown>)=>{x.expected_hash='c'.repeat(64);},(x:Record<string,unknown>)=>{x.artwork_id='alien';}]){const altered=structuredClone(r);mutate(altered);expect(()=>modelPreparationView(altered)).toThrow('MODEL_PREPARATION_RECEIPT_INVALID');}
 const altered=structuredClone(r),stored=altered.model_preparation as {result:typeof receipt};stored.result.producer.output.bytes++;expect(()=>modelPreparationReceipt(altered)).toThrow('MODEL_PREPARATION_RECEIPT_INVALID');
 const changedDigest=structuredClone(r);(changedDigest.model_preparation as {result:typeof receipt}).result.sha256='0'.repeat(64);expect(()=>modelPreparationReceipt(changedDigest)).toThrow('MODEL_PREPARATION_RECEIPT_INVALID');
});
it('allows the same asset identity only when actual original bytes and hash are reused',()=>{
 expect(modelPreparationView(ready(true))).toMatchObject({original:{assetId:'display'},display:{assetId:'display',reusedOriginal:true}});
 expect(()=>createModelPreparationReceipt(row(),'display','display',producer)).toThrow('MODEL_PREPARATION_RECEIPT_INVALID');const p=structuredClone(producer);p.output.reusedOriginal=true;expect(()=>createModelPreparationReceipt(row(),'display','display',p)).toThrow('MODEL_PREPARATION_RECEIPT_INVALID');
});

it('requires explicit active execution and rejects forged or contextless native authority',async()=>{
 const {createServiceModelPreparationExecution,createNativeModelPreparationExecution}=await import('./model-preparation-import.ts');
 const blobs={getBounded:async()=>new Uint8Array()} as unknown as BlobStore,pool={} as Pool,c={query:async()=>({rows:[{supported:true}]})} as unknown as import('pg').PoolClient;
 await expect(new Imports(pool,blobs).requiredModelReady(c)).rejects.toMatchObject({code:'MODEL_PREPARATION_UNAVAILABLE'});
 let active=false;const context=createServiceModelPreparationExecution(blobs,()=>active),service=new Imports(pool,blobs,undefined,context);
 await expect(service.requiredModelReady(c)).rejects.toMatchObject({code:'MODEL_PREPARATION_UNAVAILABLE'});active=true;await service.requiredModelReady(c);active=false;await expect(service.requiredModelReady(c)).rejects.toMatchObject({code:'MODEL_PREPARATION_UNAVAILABLE'});
 expect(()=>new Imports(pool,blobs,undefined,{...context})).toThrow('MODEL_PREPARATION_UNAVAILABLE');
 expect(()=>createNativeModelPreparationExecution(blobs,{} as import('./native-oex-provenance.ts').NativeOexWorkspaceContext,{writerFd:10,identity:{},assertLive:async()=>{}} as never,()=>true)).toThrow('FURNISHING_LEASE_INVALID');
});
