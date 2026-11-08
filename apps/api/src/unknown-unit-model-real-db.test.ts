// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {FileBlobStore,migrate,transaction,sha256} from '@exhibitos/storage';
import {pngCrc} from './png-pixels.ts';
import {Imports,type ImportInput} from './imports.ts';
import {Cms,type ArtworkMetadata} from './cms.ts';
import type {Session} from './auth.ts';
import {createServiceModelPreparationExecution} from './model-preparation-import.ts';
import {COMPACT_MODEL_RECIPE} from './oam-original-preparation.ts';
import {inspectModelOriginal} from './model-original-inspection.ts';
function fixture(colour=192,width=1){
 const chunk=(name:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(name),data]),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);body.copy(b,4);b.writeUInt32BE(pngCrc(body),b.length-4);return b;};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(width,4);ihdr[8]=8;ihdr[9]=2;
 const pixels=Buffer.alloc(width*(1+width*3));for(let y=0;y<width;y++)for(let x=0;x<width;x++){const at=y*(1+width*3)+1+x*3;pixels[at]=colour;pixels[at+1]=40;pixels[at+2]=80;}
 const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
 const parts=[Buffer.from(new Float32Array([0,0,0,1,0,.2,0,1,.4]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1,0,0,1]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),Buffer.from(new Uint32Array([0,1,2]).buffer),image];
 const views:{buffer:number;byteOffset:number;byteLength:number;target?:number}[]=[],blocks:Buffer[]=[];let length=0;
 for(const [i,part] of parts.entries()){views.push({buffer:0,byteOffset:length,byteLength:part.length,...(i<4?{target:i===3?34963:34962}:{})});blocks.push(part);length+=part.length;const pad=(4-length%4)%4;blocks.push(Buffer.alloc(pad));length+=pad;}
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0,sampler:0}],samplers:[{magFilter:9729,minFilter:9729,wrapS:10497,wrapT:10497}],images:[{bufferView:4,mimeType:'image/png'}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,Math.fround(.4)]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'},{bufferView:3,componentType:5125,count:3,type:'SCALAR'}],bufferViews:views,buffers:[{byteLength:length}]};
 const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);const out=Buffer.alloc(28+json.length+length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);Buffer.concat(blocks).copy(out,28+json.length);return out;
}

it('inspects original bytes without deriving or claiming physical units',()=>{
 const bytes=fixture(),result=inspectModelOriginal(bytes);
 expect(result).toMatchObject({qualification:'structure-only',sourceUnits:'unknown',original:{sha256:sha256(bytes),bytes:bytes.length},triangles:1,vertices:3});
 expect(result.rawBounds).toEqual({min:[0,0,0],max:[1,1,Math.fround(.4)]});
 expect(()=>inspectModelOriginal(Buffer.from('not a GLB'))).toThrow('MODEL_PREPARATION_PROFILE_UNSUPPORTED');
});
it.skipIf(!process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL)('retains unknown source revision and explicitly approves only the product-bound next reference revision',async()=>{
 const pool=new Pool({connectionString:process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL}),tenantId=randomUUID(),userId=randomUUID(),artistId=randomUUID();
 const root=await mkdtemp(join(tmpdir(),'unknown-model-')),blobs=new FileBlobStore(root),execution=createServiceModelPreparationExecution(blobs,()=>true),importer=new Imports(pool,blobs,undefined,execution),cms=new Cms(blobs),session={tenantId,userId,role:'admin'} as Session;
 const run=<T>(fn:(c:import('pg').PoolClient)=>Promise<T>)=>transaction(pool,fn);
 const source=fixture(192,640),inspection=inspectModelOriginal(source),bounds=inspection.rawBounds as {min:[number,number,number];max:[number,number,number]},height=1.5;
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic'};
 const metadata:ArtworkMetadata={title:'Uncalibrated synthetic',description:'Authored provisional display size only',dimensions:{width:1,height,depth:.4,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'unknown',scaleApplied:false,notes:'No physical-unit qualification'},displayReference:{version:1,status:'provisional-uncalibrated',assetSha256:inspection.original.sha256,rawBounds:bounds,referenceHeightMeters:height,pose:{position:[0,0,0],rotation:[0,0,0,1],scale:[height,height,height]}}};
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);await migrate(pool,new URL('../../../database/native-model-preparation/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated unknown model']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Synthetic artist'}]);
  const artwork=await run(c=>cms.createArtwork(c,session,{artistId,...metadata})),artworkId=String(artwork.id),operationID=randomUUID();
  const request:ImportInput={artworkId,idempotencyKey:operationID,mime:'model/gltf-binary',sha256:inspection.original.sha256,bytes:source.length,scaleMeters:1,rights,modelPreparation:{version:1,profileId:COMPACT_MODEL_RECIPE.id,operationID,generation:'durable-unknown-model',artworkRevision:1}};
  await expect(run(c=>importer.create(c,session,{...request,scaleMeters:2}))).rejects.toMatchObject({code:'PROVISIONAL_ASSET_MISMATCH'});
  await expect(run(c=>importer.create(c,session,{...request,modelPreparation:{...request.modelPreparation!,sourceDisplayReference:metadata.displayReference}}))).rejects.toMatchObject({code:'INVALID_MODEL_PREPARATION'});
  const created=await run(c=>importer.create(c,session,request)),jobId=String(created.id);await run(c=>importer.upload(c,session,jobId,source));await run(c=>importer.complete(c,session,jobId));
  const resumed=new Imports(pool,blobs,undefined,execution);expect(await resumed.work()).toBe(true);
  const ready=await run(async c=>resumed.view(await resumed.access(c,session,jobId))),receipt=ready.modelPreparation&&'serverReceipt' in ready.modelPreparation?ready.modelPreparation.serverReceipt:undefined;
  if(!receipt||!('original' in receipt))throw Error('missing ordinary preparation receipt');
  expect(ready.modelPreparation).toMatchObject({status:'ready',workerDrained:true});expect(receipt.display.sha256).not.toBe(inspection.original.sha256);expect(receipt.displayReference).toEqual({...metadata.displayReference,assetSha256:receipt.display.sha256});
  expect((await run(c=>cms.detail(c,session,artworkId))).approvedRevision).toBeNull();
  expect((await run(c=>cms.approve(c,session,artworkId,{revision:1,assetId:receipt.display.assetId}))).revision).toBe(2);
  const reopened=new Cms(blobs),again=await run(c=>reopened.approve(c,session,artworkId,{revision:1,assetId:receipt.display.assetId}));expect(again.revision).toBe(2);expect(again.approvedRevision).toBe(2);
  expect((await run(c=>resumed.create(c,session,request))).id).toBe(jobId);
  expect((await run(async c=>resumed.view(await resumed.access(c,session,jobId)))).modelPreparation).toMatchObject({status:'ready',workerDrained:true});
  const originalRevision=(await pool.query('SELECT snapshot FROM artwork_revisions WHERE tenant_id=$1 AND artwork_id=$2 AND revision=1',[tenantId,artworkId])).rows[0].snapshot;expect(originalRevision).toEqual(metadata);
  expect(again.metadata).toEqual({...metadata,displayReference:receipt.displayReference});
  const display=await run(c=>reopened.studioArtwork(c,session,artworkId));expect(display.artwork.units).toBe('unknown');expect(display.artwork.transform).toEqual(metadata.displayReference!.pose);expect(display.artwork.assets[0]?.sha256).toBe(receipt.display.sha256);
  const original=(await pool.query('SELECT * FROM assets WHERE tenant_id=$1 AND id=$2',[tenantId,receipt.original.assetId])).rows[0];expect(original.state).toBe('quarantine');expect(sha256(Buffer.from(await blobs.get(original.object_key)))).toBe(inspection.original.sha256);
  const badMeta=structuredClone(again.metadata!);badMeta.displayReference!.referenceHeightMeters=2;await expect(run(c=>reopened.revise(c,session,artworkId,{...badMeta,revision:2}))).rejects.toMatchObject({code:'INVALID_METADATA'});
 }finally{await pool.end();}
},45000);
