// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {Imports} from './imports.ts';
import {modelDerivationInput,MODEL_SETTINGS_SHA256,MODEL_TOOL_VERSION,type ModelDerivation} from './model-derivation.ts';
import type {Session} from './auth.ts';
function modelView(value:ReturnType<Imports['view']>){if(!('modelDerivation' in value))throw Error('EXPECTED_MODEL_VIEW');return value.modelDerivation;}
const plan:ModelDerivation={version:1,profileId:'exhibitos-near-texture-pair-v1',settingsSha256:MODEL_SETTINGS_SHA256,toolVersion:MODEL_TOOL_VERSION,operationID:'operation-one',generation:'generation-one',artworkRevision:1};
test('model request is separate and closed, binds exact recipe/tool/revision and rejects alternate identity',()=>{
 expect(modelDerivationInput(plan)).toBe(plan);expect(modelDerivationInput(undefined)).toBeUndefined();
 for(const change of [{settingsSha256:'0'.repeat(64)},{toolVersion:'47c088e'},{version:true},{artworkRevision:0},{generation:'x\ny'},{approved:true}])expect(()=>modelDerivationInput({...plan,...change})).toThrow('INVALID_MODEL_DERIVATION');
});
test('repeated model cancellation never clears an actual owned worker lease or reports early drain',async()=>{
 const importer=new Imports({} as Pool,{} as BlobStore),row:Record<string,unknown>={id:'job',mime:'model/gltf-binary',state:'processing',lease_id:'live-worker',model_derivation:{kind:'model-texture-pair',request:plan},derived:null};
 vi.spyOn(importer,'access').mockImplementation(async()=>row);
 const query=vi.fn(async(sql:string)=>{if(sql.startsWith('UPDATE import_jobs')){row.state='cancelled';if(sql.includes('lease_id=NULL'))row.lease_id=null;}return {rows:[row]};}),c={query} as unknown as PoolClient,s={} as Session;
 const first=await importer.action(c,s,'job','cancel'),second=await importer.action(c,s,'job','cancel');
 expect(modelView(first).workerDrained).toBe(false);expect(modelView(second).workerDrained).toBe(false);expect(row.lease_id).toBe('live-worker');
 // The separate worker owner reaches close before its finally can clear a lease.
 row.lease_id=null;expect(modelView(importer.view(row)).workerDrained).toBe(true);
});
test('optional derivative failure and legacy prepared-image view remain distinct from original import state',()=>{
 const importer=new Imports({} as Pool,{} as BlobStore),view=importer.view({state:'approved',asset_id:'full',mime:'model/gltf-binary',lease_id:null,derived:null,model_derivation:{kind:'model-texture-pair',request:plan,result:{status:'failed',fullAssetId:'full',errorCode:'MODEL_DERIVATIVE_UNSUPPORTED'}}});
 expect(view.state).toBe('approved');expect(view.assetId).toBe('full');expect(modelView(view)).toMatchObject({status:'failed',workerDrained:true,fullAssetId:'full'});expect(view).not.toHaveProperty('originalAssetId');
 const legacy=importer.view({state:'approved',asset_id:'png',original_asset_id:'jpeg',mime:'image/jpeg',derived:{mime:'image/png'},model_derivation:null});expect(legacy).toHaveProperty('originalAssetId','jpeg');expect(legacy).not.toHaveProperty('modelDerivation');
});
