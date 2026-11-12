// SPDX-License-Identifier: AGPL-3.0-or-later
import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Artwork} from '@exhibitos/spec';
import type {Session} from './auth.ts';
import {ApiError} from './api-error.ts';
import {assembleGpuModelDerivative} from './gpu-model-producer.ts';
import {COMPACT_MODEL_LIMITS} from './oam-original-preparation.ts';
import {pngCrc} from './png-pixels.ts';
import {GPU_MODEL_PREPARATION_RECIPE_SHA256,bindGpuModelPreparationIntent,GPU_MODEL_PREPARATION_PROFILE} from './gpu-model-preparation-contract.ts';
import {createGpuModelReceipt,gpuModelDigest} from './gpu-model-preparation-state.ts';
import {applyGpuModelApproval,assertGpuModelBytes,approvedGpuModelPublicationSource} from './approved-gpu-model.ts';
import {GPU_MODEL_NAMESPACE,MAX_GPU_MODEL_TRIANGLES,artworkGpuModelFor} from '@exhibitos/studio-contract';
const state=vi.hoisted(()=>({owner:undefined as unknown}));
vi.mock('@exhibitos/storage',async original=>({...await original<typeof import('@exhibitos/storage')>(),artworkAccess:async(_c:unknown,s:{tenantId:string;userId:string})=>{if(s.tenantId!==tenant||s.userId!==principal)throw new ApiError(403,'FORBIDDEN');return structuredClone(state.owner);}}));
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const identity=(b:Buffer)=>({bytes:b.length,sha256:sha(b)});
function png(value:number,width=512,channels=3){
 const chunk=(name:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(name),data]),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);body.copy(b,4);b.writeUInt32BE(pngCrc(body),b.length-4);return b;};
 const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(512,4);h[8]=8;h[9]=channels===3?2:6;
 const rows=Buffer.alloc((width*channels+1)*512,value);for(let y=0;y<512;y++)rows[y*(width*channels+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function glb(text:string,bin:Buffer){
 const raw=Buffer.from(text),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
 const out=Buffer.alloc(28+json.length+bin.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(bin.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);bin.copy(out,28+json.length);return out;
}
function fixture(options:{width?:number;channels?:number;transform?:(text:string)=>string}={}){
 const images=[png(80,options.width,options.channels),png(128),png(240)];
 const parts=[Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1,0,0,1]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),Buffer.from(new Uint16Array([0,1,2]).buffer),...images];
 const views:{buffer:number;byteOffset:number;byteLength:number;target?:number}[]=[],blocks:Buffer[]=[];let length=0;
 for(const [i,part]of parts.entries()){views.push({buffer:0,byteOffset:length,byteLength:part.length,...(i<4?{target:i===3?34963:34962}:{})});blocks.push(part);length+=part.length;const padding=(4-length%4)%4;blocks.push(Buffer.alloc(padding));length+=padding;}
 // Original undeclared BIN padding is deliberately nonzero. It must survive too.
 blocks.push(Buffer.from([91,92,93,94]));const bin=Buffer.concat(blocks);
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:2},baseColorFactor:[0.8,0.9,1,1]},normalTexture:{index:0},occlusionTexture:{index:1}}],textures:[{source:1},{source:2},{source:0}],images:images.map((_,i)=>({bufferView:i+4,mimeType:'image/png'})),accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'},{bufferView:3,componentType:5123,count:3,type:'SCALAR'}],bufferViews:views,buffers:[{byteLength:bin.length-3}]};
 const text=JSON.stringify(doc),source=glb(options.transform?.(text)??text,bin);return {source,bin,doc,images};
}
function ktx(){
 // Closed synthetic container; payload is NOT a real encoding or quality proof.
 const sizes=[262144,65536,16384,4096,1024,256,64,16,16,16],out=Buffer.alloc(368+sizes.reduce((a,b)=>a+b,0));
 Buffer.from([171,75,84,88,32,50,48,187,13,10,26,10]).copy(out);
 for(const[at,n]of[[16,1],[20,512],[24,512],[36,1],[40,10],[48,320],[52,44]])out.writeUInt32LE(n!,at!);
 Buffer.from('2c0000000000000002002800a601020003030000100000000000000000007f000000000000000000ffffffff','hex').copy(out,320);let offset=368;
 for(let i=9;i>=0;i--){out.writeBigUInt64LE(BigInt(offset),80+i*24);out.writeBigUInt64LE(BigInt(sizes[i]!),88+i*24);out.writeBigUInt64LE(BigInt(sizes[i]!),96+i*24);out.fill(i+1,offset,offset+sizes[i]!);offset+=sizes[i]!;}return out;
}

const tenant='11111111-1111-4111-8111-111111111111',principal='22222222-2222-4222-8222-222222222222',artworkId='33333333-3333-4333-8333-333333333333',sourceId='44444444-4444-4444-8444-444444444444',jobId='55555555-5555-4555-8555-555555555555',candidateId='66666666-6666-4666-8666-666666666666',lodId='77777777-7777-4777-8777-777777777777';
// Dynamic SQL rows match pg's record boundary. Production parsers remain real.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row=Record<string,any>;
let row:Row,owner:Row,original:Row,selected:Row,assets:Row[],lineage:Row[],artwork:Artwork,source:Buffer,candidate:Buffer,objects:Map<string,Buffer>,getBounded:ReturnType<typeof vi.fn>;
const session={tenantId:tenant,userId:principal} as Session;
const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
 if(sql.startsWith('SELECT * FROM import_jobs'))return {rows:[structuredClone(row)]};
 if(sql.startsWith('SELECT snapshot'))return {rows:[{snapshot:structuredClone(Number(args[2])===7?original:selected)}]};
 if(sql.startsWith('SELECT a.*,r.metadata'))return {rows:structuredClone(assets)};
 if(sql.startsWith('SELECT metadata'))return {rows:structuredClone(lineage)};
 throw Error('UNEXPECTED_SQL:'+sql);
});
const client={query} as unknown as PoolClient;
const blobs=()=>({getBounded} as unknown as BlobStore);
beforeEach(()=>{
 source=fixture().source;const output=assembleGpuModelDerivative(source,identity(source),ktx());candidate=output.bytes;
 const rights={holder:'Synthetic test',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,export:true,download:true,commercial:false}};
 original={asset:{id:sourceId,mime:'model/gltf-binary',...identity(source)},metadata:{rights}};
 const intent=bindGpuModelPreparationIntent({revision:7,assetId:sourceId,...identity(source),idempotencyKey:'synthetic-job',generation:'native-client-7',profile:GPU_MODEL_PREPARATION_PROFILE},{tenantId:tenant,principalId:principal,artworkId,approvalSHA256:gpuModelDigest(original),rightsSHA256:gpuModelDigest(rights)});
 row={tenant_id:tenant,user_id:principal,artwork_id:artworkId,id:jobId,idempotency_key:'synthetic-job',expected_hash:sha(source),expected_bytes:source.length,mime:'model/gltf-binary',object_key:'original-source',approved_key:'approved-candidate',scale_meters:1,rights:structuredClone(rights),state:'approved',asset_id:candidateId,png_drain_version:1,png_worker_tokens:[],lease_id:null,gpu_preparation:{kind:'gpu-model-preparation',intent,executionRecipeSHA256:GPU_MODEL_PREPARATION_RECIPE_SHA256}};
 const receipt=createGpuModelReceipt(row,{assetId:candidateId,mime:'model/gltf-binary',...identity(candidate)},output.producer);row.gpu_preparation.result=receipt;selected={...structuredClone(original),gpuVariant:structuredClone(receipt)};
 owner={revision:8,approved_revision:8,approved_asset_id:sourceId,metadata:{rights:structuredClone(rights)}};state.owner=owner;
 assets=[{id:sourceId,object_key:row.object_key,mime:'model/gltf-binary',...identity(source),scale_meters:1,current_rights:structuredClone(rights)},{id:candidateId,object_key:row.approved_key,mime:'model/gltf-binary',...identity(candidate),scale_meters:1,current_rights:structuredClone(rights)}];
 lineage=[{metadata:{version:1,kind:'approved-display-gpu-derivative',serverReceipt:structuredClone(receipt),provenance:'server-generated'}}];
 artwork={id:artworkId,revision:8,artworkType:'sculpture',primaryAssetId:sourceId,assets:[{id:sourceId,path:`assets/${sourceId}/model.glb`,role:'model',mime:'model/gltf-binary',...identity(source)},{id:lodId,path:`assets/${lodId}/model.glb`,role:'model',mime:'model/gltf-binary',bytes:100,sha256:'d'.repeat(64)}],rights:structuredClone(rights),extensions:{'org.exhibitos.viewer/lod':{version:1,variants:[{assetId:lodId,detail:'coarse'}]},'org.exhibitos.studio/cms':{tenantId:tenant,artworkId,revision:8},'synthetic-role-metadata':{retained:true}}} as unknown as Artwork;
 objects=new Map([[row.object_key,Buffer.from(source)],[row.approved_key,Buffer.from(candidate)]]);getBounded=vi.fn(async(key:string,limit:number)=>{const b=objects.get(key);if(!b||b.length>limit)throw Error('MISSING_BLOB');return Buffer.from(b);});query.mockClear();
});
it('projects only the explicitly selected immutable receipt using actual synthetic GLB reconstruction, preserving primary/LOD/roles/rights',async()=>{
 const before=structuredClone(artwork),value=structuredClone(row.gpu_preparation.result);await applyGpuModelApproval(client,session,artworkId,artwork,value,blobs());
 expect(artwork.primaryAssetId).toBe(sourceId);expect(artwork.assets.slice(0,2)).toEqual(before.assets);expect(artwork.rights).toEqual(before.rights);expect(artwork.extensions).toMatchObject(before.extensions!);expect(artwork.extensions![GPU_MODEL_NAMESPACE]).toEqual({version:1,profile:GPU_MODEL_PREPARATION_PROFILE,recipeSHA256:value.recipeSHA256,receiptSHA256:value.sha256,sourceAssetId:sourceId,candidateAssetId:candidateId,triangles:1,textureSize:512});expect(artwork.assets[2]).toMatchObject({id:candidateId,role:'model',sha256:sha(candidate),bytes:candidate.length});
 const projected=structuredClone(artwork);await applyGpuModelApproval(client,session,artworkId,artwork,value,blobs());expect(artwork).toEqual(projected);expect(objects.get(row.object_key)).toEqual(source);expect(objects.get(row.approved_key)).toEqual(candidate);
 expect(query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});
it.each(['current-revision','approved-revision','primary','source-approval','selection','rights','candidate-rights','source-sha','candidate-sha','lineage','duplicate-lineage','undrained','foreign-job','receipt','candidate-id-collision','wrong-projected-revision'] as const)('rejects %s without partial projection',async mode=>{
 const value=structuredClone(row.gpu_preparation.result);
 if(mode==='current-revision')owner.revision=9;if(mode==='approved-revision')owner.approved_revision=7;if(mode==='primary')artwork.primaryAssetId=lodId;
 if(mode==='source-approval')original.metadata.tampered=true;if(mode==='selection')selected.gpuVariant.sha256='f'.repeat(64);if(mode==='rights')owner.metadata.rights.permissions.export=false;if(mode==='candidate-rights')assets[1]!.current_rights.permissions.display=false;if(mode==='source-sha')assets[0]!.sha256='0'.repeat(64);if(mode==='candidate-sha')assets[1]!.sha256='0'.repeat(64);if(mode==='lineage')lineage[0]!.metadata.provenance='client';if(mode==='duplicate-lineage')lineage.push(structuredClone(lineage[0]!));if(mode==='undrained')row.png_worker_tokens=[jobId];if(mode==='foreign-job')row.user_id=sourceId;if(mode==='receipt')value.extra='untrusted';if(mode==='candidate-id-collision')artwork.assets.push({...artwork.assets[1]!,id:candidateId});if(mode==='wrong-projected-revision')artwork.revision=7;
 const before=structuredClone(artwork);await expect(applyGpuModelApproval(client,session,artworkId,artwork,value,blobs())).rejects.toMatchObject({status:409});expect(artwork).toEqual(before);
});
it.each(['source','candidate','missing','rebuilt-metrics'] as const)('rejects tampered %s custody even if a caller supplies a receipt hash',async mode=>{
 const value=structuredClone(row.gpu_preparation.result);
 if(mode==='source'){const b=objects.get(row.object_key)!;b[0]=b[0]!^1;}if(mode==='candidate'){const b=objects.get(row.approved_key)!;b[0]=b[0]!^1;}if(mode==='missing')objects.delete(row.approved_key);
 if(mode==='rebuilt-metrics'){
  // Re-hash a structurally valid but false producer metric at every stored layer.
  value.producer.geometry.triangles=2;const body=structuredClone(value);delete body.sha256;value.sha256=gpuModelDigest(body);row.gpu_preparation.result=structuredClone(value);selected.gpuVariant=structuredClone(value);lineage[0]!.metadata.serverReceipt=structuredClone(value);
 }
 const before=structuredClone(artwork);await expect(applyGpuModelApproval(client,session,artworkId,artwork,value,blobs())).rejects.toMatchObject({code:'ASSET_INTEGRITY'});expect(artwork).toEqual(before);
});
it('requires bounded storage and current authenticated ownership, never encoder execution',async()=>{
 await expect(applyGpuModelApproval(client,session,artworkId,artwork,row.gpu_preparation.result)).rejects.toMatchObject({status:503});await expect(applyGpuModelApproval(client,{...session,userId:sourceId},artworkId,artwork,row.gpu_preparation.result,blobs())).rejects.toMatchObject({status:403});expect(getBounded).not.toHaveBeenCalled();
});

it('verifies a portable opaque receipt carrier by deterministic bytes without requiring a local private job receipt',async()=>{
 await applyGpuModelApproval(client,session,artworkId,artwork,row.gpu_preparation.result,blobs());const selection=artworkGpuModelFor(artwork)!;selection.binding.receiptSHA256='e'.repeat(64);query.mockClear();expect(assertGpuModelBytes(source,candidate,selection)).toEqual(row.gpu_preparation.result.producer);expect(query).not.toHaveBeenCalled();
});
it.each(['triangles','source-hash','candidate-hash','source-bytes','candidate-bytes','recipe','profile'] as const)('rejects portable pair %s mismatch independently of receipt provenance',async mode=>{
 await applyGpuModelApproval(client,session,artworkId,artwork,row.gpu_preparation.result,blobs());const selection=artworkGpuModelFor(artwork)!;
 if(mode==='triangles')selection.binding.triangles=2;if(mode==='source-hash')selection.source.sha256='f'.repeat(64);if(mode==='candidate-hash')selection.candidate.sha256='f'.repeat(64);if(mode==='source-bytes')selection.source.bytes++;if(mode==='candidate-bytes')selection.candidate.bytes++;if(mode==='recipe')Object.assign(selection.binding,{recipeSHA256:'f'.repeat(64)});if(mode==='profile')Object.assign(selection.binding,{profile:'unknown'});
 expect(()=>assertGpuModelBytes(source,candidate,selection)).toThrow('ASSET_INTEGRITY');
});
it('matches only the GPU candidate of a strict immutable local approval and refuses receipt/rights/source/producer tampering',()=>{
 const target={id:candidateId,...identity(candidate),mime:'model/gltf-binary'};expect(approvedGpuModelPublicationSource(selected,target,sourceId)).toBe(true);expect(approvedGpuModelPublicationSource(selected,target,lodId)).toBe(false);expect(approvedGpuModelPublicationSource(selected,{...target,sha256:'f'.repeat(64)},sourceId)).toBe(false);
 for(const mode of ['hash','rights','source','producer','extra'] as const){const approval=structuredClone(selected);if(mode==='hash')approval.gpuVariant.sha256='0'.repeat(64);if(mode==='rights')approval.metadata.rights.permissions.export=false;if(mode==='source')approval.asset.sha256='0'.repeat(64);if(mode==='producer')approval.gpuVariant.producer.ktx.extra=true;if(mode==='extra')approval.gpuVariant.extra=true;
  if(mode==='producer'||mode==='extra'){const body=structuredClone(approval.gpuVariant);delete body.sha256;approval.gpuVariant.sha256=gpuModelDigest(body);}expect(approvedGpuModelPublicationSource(approval,target,sourceId)).toBe(false);
 }
});
it('matches an imported portable member only against its approved primary and rights, without inventing a local receipt',async()=>{
 await applyGpuModelApproval(client,session,artworkId,artwork,row.gpu_preparation.result,blobs());const approval={...structuredClone(original),importedArtwork:structuredClone(artwork)},target={id:candidateId,...identity(candidate),mime:'model/gltf-binary'};
 expect(approvedGpuModelPublicationSource(approval,target,sourceId)).toBe(true);approval.importedArtwork.rights=structuredClone(approval.importedArtwork.rights);Object.assign(approval.importedArtwork.rights,{creditLine:'different rights'});expect(approvedGpuModelPublicationSource(approval,target,sourceId)).toBe(false);
});

it('keeps the portable triangle cap equal to the actual ordinary producer source inspector cap',()=>{expect(MAX_GPU_MODEL_TRIANGLES).toBe(COMPACT_MODEL_LIMITS.triangles);});
