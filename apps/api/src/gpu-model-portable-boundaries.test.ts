// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {expect,it} from 'vitest';
import {GPU_MODEL_NAMESPACE,GPU_MODEL_PROFILE,GPU_MODEL_RECIPE_SHA256,artworkGpuModelFor,validateArtworkGpuModel,LOD_NAMESPACE,NEAR_TEXTURE_PAIR_PROFILE,type ArtworkGpuModel} from '@exhibitos/studio-contract';
import {projectPublication,approvedPublicationSource} from './publication.ts';
import {remapOex,checkOexProfile} from './oex.ts';
import {assembleGpuModelDerivative} from './gpu-model-producer.ts';
import {GPU_MODEL_PREPARATION_RECIPE_SHA256,bindGpuModelPreparationIntent} from './gpu-model-preparation-contract.ts';
import {createGpuModelReceipt,gpuModelDigest} from './gpu-model-preparation-state.ts';
import {pngCrc} from './png-pixels.ts';
// Synthetic structural container copied from the producer's unit fixture.
// No real UASTC encoding, transcode, fidelity or resource savings are established.
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
function syntheticSource(options:{width?:number;channels?:number;transform?:(text:string)=>string}={}){
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

async function portableFixture(){
 const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),artwork=exhibition.artworks.find(a=>a.artworkType==='sculpture')!;
 const sourceBytes=syntheticSource().source,result=assembleGpuModelDerivative(sourceBytes,identity(sourceBytes),ktx());
 const source={...artwork.assets.find(a=>a.id===artwork.primaryAssetId)!,...identity(sourceBytes)},candidate={...source,id:randomUUID(),...identity(result.bytes)};
 candidate.path=`assets/${candidate.id}/model.glb`;
 const lowBytes=Buffer.alloc(32,9),low={...source,id:randomUUID(),...identity(lowBytes)};low.path=`assets/${low.id}/model.glb`;
 artwork.assets=[source,candidate,low];artwork.primaryAssetId=source.id;artwork.revision=4;
 artwork.metadata.description=`Synthetic prose mentions ${source.id} and ${candidate.id}; neither is a typed reference.`;
 const originalApproval={asset:{id:source.id,sha256:source.sha256,bytes:source.bytes,mime:source.mime},metadata:{rights:artwork.rights}};
 const request={revision:3,assetId:source.id,sha256:source.sha256,bytes:source.bytes,idempotencyKey:'synthetic-portable-gpu',generation:'synthetic-portable-generation',profile:GPU_MODEL_PROFILE};
 const intent=bindGpuModelPreparationIntent(request,{tenantId:randomUUID(),principalId:randomUUID(),artworkId:artwork.id,approvalSHA256:gpuModelDigest(originalApproval),rightsSHA256:gpuModelDigest(artwork.rights)});
 const row={id:randomUUID(),tenant_id:intent.binding.tenantId,user_id:intent.binding.principalId,artwork_id:artwork.id,idempotency_key:request.idempotencyKey,expected_hash:source.sha256,expected_bytes:source.bytes,mime:source.mime,png_drain_version:1,rights:artwork.rights,gpu_preparation:{kind:'gpu-model-preparation',intent,executionRecipeSHA256:GPU_MODEL_PREPARATION_RECIPE_SHA256}};
 const receipt=createGpuModelReceipt(row,{assetId:candidate.id,mime:'model/gltf-binary',sha256:candidate.sha256,bytes:candidate.bytes},result.producer);
 const binding:ArtworkGpuModel={version:1,profile:GPU_MODEL_PROFILE,recipeSHA256:GPU_MODEL_RECIPE_SHA256,receiptSHA256:receipt.sha256,sourceAssetId:source.id,candidateAssetId:candidate.id,triangles:1,textureSize:512};
 artwork.extensions={[GPU_MODEL_NAMESPACE]:binding as unknown as NonNullable<typeof artwork.extensions>[string],[LOD_NAMESPACE]:{version:1,profile:NEAR_TEXTURE_PAIR_PROFILE,variants:[{assetId:source.id,detail:'full',triangles:1,textureSize:512},{assetId:low.id,detail:'coarse',triangles:1,textureSize:256}]}};
 exhibition.artworks=[artwork];exhibition.placements=exhibition.placements.filter(p=>p.artworkRevisionId===artwork.revisionId);exhibition.annotations=exhibition.annotations.filter(v=>exhibition.placements.some(p=>p.id===v.placementId));exhibition.mediaAssets=[];exhibition.audioZones=[];exhibition.scripts=[];exhibition.accessibility.artworkDescriptions=exhibition.accessibility.artworkDescriptions.filter(v=>exhibition.placements.some(p=>p.id===v.placementId));
 const approval={...originalApproval,gpuVariant:receipt};
 return {exhibition,artwork,source,candidate,low,sourceBytes,candidateBytes:result.bytes,lowBytes,binding,receipt,approval};
}

function prepared(f:Awaited<ReturnType<typeof portableFixture>>):Parameters<typeof projectPublication>[1][number]{
 return {artwork:f.artwork,sourceAssetId:f.source.id,sourceSha256:f.source.sha256,bytes:f.sourceBytes,mime:'model/gltf-binary' as const,coarseSource:{id:f.low.id,sha256:f.low.sha256},variants:{profile:NEAR_TEXTURE_PAIR_PROFILE,full:{triangles:1,textureSize:512},coarse:{triangles:1,textureSize:256},bytes:f.lowBytes},gpu:{binding:f.binding,bytes:f.candidateBytes}};
}
const publishedAt='2026-11-12T00:00:00Z';
function lodMetrics(artwork:Awaited<ReturnType<typeof portableFixture>>['artwork']){
 return (artwork.extensions?.[LOD_NAMESPACE] as unknown as {profile:string;variants:{detail:string;triangles:number;textureSize:number}[]}).variants.map(v=>({detail:v.detail,triangles:v.triangles,textureSize:v.textureSize}));
}
it('projects original primary, separate GPU encoding and independent full/coarse LOD, then remaps only typed references through OEX',async()=>{
 const f=await portableFixture(),before=structuredClone(f.exhibition),result=projectPublication(f.exhibition,[prepared(f)],publishedAt),output=result.snapshot.artworks[0]!,gpu=artworkGpuModelFor(output)!;
 expect(validateArtworkGpuModel(output).valid).toBe(true);expect(gpu).toBeDefined();expect(output.primaryAssetId).toBe(gpu.source.id);expect(gpu.candidate.id).not.toBe(gpu.source.id);expect(gpu.source.sha256).toBe(f.source.sha256);expect(gpu.candidate.sha256).toBe(f.candidate.sha256);expect(gpu.candidate.bytes).toBe(f.candidateBytes.length);expect(gpu.binding.receiptSHA256).toBe(f.receipt.sha256);
 expect(Object.keys(gpu.binding).sort()).toEqual(['version','profile','recipeSHA256','receiptSHA256','sourceAssetId','candidateAssetId','triangles','textureSize'].sort());
 expect(lodMetrics(output)).toEqual(lodMetrics(f.artwork));expect(lodMetrics(output)).toEqual([{detail:'full',triangles:1,textureSize:512},{detail:'coarse',triangles:1,textureSize:256}]);
 expect(output.metadata.description).toBe(f.artwork.metadata.description);expect(()=>checkOexProfile(result.snapshot)).not.toThrow();
 const candidateResource=result.assets.find(a=>a.id===gpu.candidate.id)!;
 expect(candidateResource.prepared.sourceAssetId).toBe(f.candidate.id);expect(candidateResource.prepared.sourceSha256).toBe(f.candidate.sha256);expect(candidateResource.prepared.bytes).toEqual(f.candidateBytes);
 const remapped=remapOex(result.snapshot).exhibition,imported=remapped.artworks[0]!,next=artworkGpuModelFor(imported)!;
 expect(next.binding.sourceAssetId).not.toBe(gpu.binding.sourceAssetId);expect(next.binding.candidateAssetId).not.toBe(gpu.binding.candidateAssetId);expect(next.binding.sourceAssetId).toBe(imported.primaryAssetId);expect(next.binding.candidateAssetId).toBe(next.candidate.id);expect(next.binding.receiptSHA256).toBe(f.receipt.sha256);expect(next.binding.recipeSHA256).toBe(GPU_MODEL_RECIPE_SHA256);
 expect(next.source.sha256).toBe(gpu.source.sha256);expect(next.candidate.sha256).toBe(gpu.candidate.sha256);expect(imported.metadata.description).toBe(f.artwork.metadata.description);expect(lodMetrics(imported)).toEqual(lodMetrics(f.artwork));expect(()=>checkOexProfile(remapped)).not.toThrow();expect(f.exhibition).toEqual(before);
});

it('keeps the actual original bytes and primary selected even when the synthetic GPU candidate is larger',async()=>{
 const f=await portableFixture();expect(f.candidateBytes.length).toBeGreaterThan(f.sourceBytes.length);
 const result=projectPublication(f.exhibition,[prepared(f)],publishedAt),output=result.snapshot.artworks[0]!,gpu=artworkGpuModelFor(output)!;
 expect(result.assets.find(a=>a.id===output.primaryAssetId)!.prepared.bytes).toEqual(f.sourceBytes);expect(gpu.binding.sourceAssetId).toBe(output.primaryAssetId);expect(gpu.binding.triangles).toBe(1);expect(output.assets).toHaveLength(3);
});

it('rejects malformed or dangling GPU carriers at the portable OEX admission boundary',async()=>{
 const f=await portableFixture();expect(()=>checkOexProfile(f.exhibition)).not.toThrow();
 for(const delta of [{recipeSHA256:'0'.repeat(64)},{candidateAssetId:f.source.id},{candidateAssetId:randomUUID()},{sourceAssetId:randomUUID()},{textureSize:256},{triangles:NaN},{cpuBytes:1}]){
  const changed=structuredClone(f.exhibition);Object.assign(changed.artworks[0]!.extensions![GPU_MODEL_NAMESPACE]!,delta);
  expect(()=>checkOexProfile(changed)).toThrow();
 }
 const wrongRole=structuredClone(f.exhibition);wrongRole.artworks[0]!.assets.find(a=>a.id===f.candidate.id)!.role='preview';expect(()=>checkOexProfile(wrongRole)).toThrow();
});

it('fails publication closed on absent bytes, mismatched carrier, malformed metadata or changed model identity',async()=>{
 const f=await portableFixture();
 const missing=prepared(f);delete missing.gpu;expect(()=>projectPublication(f.exhibition,[missing],publishedAt)).toThrow('PUBLICATION_NOT_READY');
 for(const delta of [{binding:{...f.binding,receiptSHA256:'0'.repeat(64)}},{bytes:Buffer.from(f.candidateBytes).fill(0)},{bytes:f.candidateBytes.subarray(0,-1)}])expect(()=>projectPublication(f.exhibition,[{...prepared(f),gpu:{...prepared(f).gpu!,...delta}}],publishedAt)).toThrow('PUBLICATION_NOT_READY');
 for(const alter of [(v:typeof f.artwork)=>{(v.extensions![GPU_MODEL_NAMESPACE] as unknown as {recipeSHA256:string}).recipeSHA256='0'.repeat(64);},(v:typeof f.artwork)=>{v.assets.find(a=>a.id===f.source.id)!.bytes++;},(v:typeof f.artwork)=>{v.assets.find(a=>a.id===f.source.id)!.sha256='0'.repeat(64);},(v:typeof f.artwork)=>{v.assets.find(a=>a.id===f.candidate.id)!.id=randomUUID();}]){
  const exhibition=structuredClone(f.exhibition),artwork=exhibition.artworks[0]!;alter(artwork);expect(()=>projectPublication(exhibition,[{...prepared(f),artwork}],publishedAt)).toThrow('PUBLICATION_NOT_READY');
 }
});

it('authorizes a GPU publication secondary only through the exact closed immutable selected receipt',async()=>{
 const f=await portableFixture();expect(approvedPublicationSource(f.approval,f.source,f.source.id)).toBe(true);expect(approvedPublicationSource(f.approval,f.candidate,f.source.id)).toBe(true);
 for(const candidate of [{...f.candidate,id:randomUUID()},{...f.candidate,sha256:'0'.repeat(64)},{...f.candidate,bytes:f.candidate.bytes+1},{...f.candidate,mime:'image/png'}])expect(approvedPublicationSource(f.approval,candidate,f.source.id)).toBe(false);
 expect(approvedPublicationSource({...f.approval,gpuVariant:undefined},f.candidate,f.source.id)).toBe(false);
 const changedSource={...f.approval,asset:{...f.approval.asset,sha256:'0'.repeat(64)}};expect(approvedPublicationSource(changedSource,f.candidate,f.source.id)).toBe(false);
 expect(approvedPublicationSource({...f.approval,asset:{...f.approval.asset,bytes:f.source.bytes+1}},f.candidate,f.source.id)).toBe(false);
 const rights=structuredClone(f.approval);rights.metadata.rights.permissions.export=false;expect(approvedPublicationSource(rights,f.candidate,f.source.id)).toBe(false);
});

it('rejects a recomputed receipt digest when the frozen recipe or closed producer semantics change',async()=>{
 const f=await portableFixture();
 for(const change of [(r:typeof f.receipt)=>{r.recipeSHA256='0'.repeat(64) as typeof r.recipeSHA256;},(r:typeof f.receipt)=>{r.producer.ktx.levels=1 as 10;},(r:typeof f.receipt)=>{(r.producer.roles[0]! as {colorSpace:string}).colorSpace='linear';},(r:typeof f.receipt)=>{Object.assign(r,{unknown:true});}]){
  const receipt=structuredClone(f.receipt);change(receipt);const {sha256:previous,...body}=receipt;expect(previous).toBe(f.receipt.sha256);receipt.sha256=gpuModelDigest(body);expect(approvedPublicationSource({...f.approval,gpuVariant:receipt},f.candidate,f.source.id)).toBe(false);
 }
});
it('never silently strips a malformed known GPU carrier when prepared encoding bytes are omitted',async()=>{
 const f=await portableFixture(),input=prepared(f);delete input.gpu;
 (f.artwork.extensions![GPU_MODEL_NAMESPACE] as unknown as Record<string,unknown>).recipeSHA256='0'.repeat(64);
 expect(()=>projectPublication(f.exhibition,[input],publishedAt)).toThrow('PUBLICATION_NOT_READY');
});
