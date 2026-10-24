// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixtureURL} from '@exhibitos/spec';
import {decode} from '../apps/api/dist/imports.js';
import {derivative} from '../apps/api/dist/derivative.js';
import {viewerVariants,measureFullVariant} from '../apps/api/dist/viewer-variants.js';
import {publicPBRTexturedLODPair,publicPBRTexturedGLB,publicTexturedGLB,publicTexturePNG,changeTextureGLB,texturePNGChunk,publicTexturedLODPair,publicBasisKtx,withPublicBasis} from './embedded-texture-fixture.mjs';
import {qualifyApprovedTexturedPair} from '../apps/api/dist/approved-lod-pair.js';
const mime='model/gltf-binary',parse=b=>JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
test('public independent embedded PNG plane is accepted by isolated profile and official validator',async()=>{await decode(publicTexturedGLB(),mime);await decode(await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),mime);});
test('watermark clone retains exact image views and full source while unsupported coarse texture falls back explicitly',async()=>{const source=publicTexturedGLB(),marked=await derivative(source,mime),a=parse(source),b=parse(marked),bin=buf=>buf.subarray(28+buf.readUInt32LE(12));await decode(marked,mime);assert.deepEqual(b.images,a.images);for(const image of a.images){const v=a.bufferViews[image.bufferView];assert.deepEqual(bin(marked).subarray(v.byteOffset,v.byteOffset+v.byteLength),bin(source).subarray(v.byteOffset,v.byteOffset+v.byteLength));}const full=measureFullVariant(marked,mime);assert.equal(full.textureSize,2);await assert.rejects(viewerVariants(marked,mime),/COARSE_UNAVAILABLE/);assert.deepEqual(measureFullVariant(marked,mime),full);});
test('external buffers images extensions and unsupported image/sampler/material references are refused',async()=>{for(const edit of [d=>d.buffers[0].uri='https://example.invalid/a.bin',d=>d.images[0].uri='https://example.invalid/a.png',d=>d.images[0].mimeType='image/jpeg',d=>d.extensions={unknown:{}},d=>d.asset.extras={nested:{uri:'file:///private'}},d=>d.samplers[0].minFilter=9987,d=>d.samplers[0].wrapS=99999,d=>d.samplers[0].unknown=true,d=>d.textures[0].source=8,d=>d.materials[0].normalTexture={index:0,scale:.5},d=>d.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord=1,d=>d.materials[0].pbrMetallicRoughness.baseColorTexture.index=8])await assert.rejects(decode(changeTextureGLB(publicTexturedGLB(),edit),mime));});
test('image CRC truncated streams inflate bomb and overlarge/aggregate dimensions are refused before unbounded expansion',async()=>{const valid=publicTexturePNG(),crc=Buffer.from(valid);crc[29]^=1;await assert.rejects(decode(publicTexturedGLB({png:crc}),mime));await assert.rejects(decode(publicTexturedGLB({png:valid.subarray(0,valid.length-3)}),mime));await assert.rejects(decode(publicTexturedGLB({png:publicTexturePNG(2050,2)}),mime));const body=Buffer.from(publicTexturePNG(1024,1024));await assert.rejects(decode(publicTexturedGLB({png:body,images:3}),mime));const h=Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(2,4);h[8]=8;h[9]=6;const expanded=publicTexturePNG(64,64),idat=expanded.subarray(33,expanded.length-12);const bomb=Buffer.concat([valid.subarray(0,8),texturePNGChunk('IHDR',h),idat,texturePNGChunk('IEND',Buffer.alloc(0))]);await assert.rejects(decode(publicTexturedGLB({png:bomb}),mime));});
test('exact chunk image-view boundaries finite UV and declaration mismatches fail closed',async()=>{for(const edit of [d=>d.bufferViews[d.images[0].bufferView].byteLength=0,d=>d.bufferViews[d.images[0].bufferView].byteOffset=999999,d=>d.buffers[0].byteLength=1,d=>d.accessors[2].count=5,(_d,b)=>b.writeFloatLE(NaN,96),(_d,b)=>b.writeFloatLE(20001,96)])await assert.rejects(decode(changeTextureGLB(publicTexturedGLB(),edit),mime));const trailing=Buffer.concat([publicTexturedGLB(),Buffer.alloc(4)]);trailing.writeUInt32LE(trailing.length,8);await assert.rejects(decode(trailing,mime));});

test('explicit approved textured pair retains geometry PNG and independently measured watermark variants',async()=>{const {full,coarse}=publicTexturedLODPair();const before=Buffer.from(full);for(const bytes of [full,coarse])await decode(bytes,mime);assert.deepEqual(qualifyApprovedTexturedPair(full,coarse,8,2),{full:{triangles:8,textureSize:2},coarse:{triangles:2,textureSize:2}});const markedFull=await derivative(full,mime),markedCoarse=await derivative(coarse,mime);await decode(markedFull,mime);await decode(markedCoarse,mime);assert.ok(measureFullVariant(markedFull,mime).triangles>measureFullVariant(markedCoarse,mime).triangles);assert.ok(markedFull.length>markedCoarse.length);assert.deepEqual(full,before);for(const [original,marked] of [[full,markedFull],[coarse,markedCoarse]]){const doc=parse(original),bin=b=>b.subarray(28+b.readUInt32LE(12));for(const im of doc.images){const v=doc.bufferViews[im.bufferView];assert.deepEqual(bin(marked).subarray(v.byteOffset,v.byteOffset+v.byteLength),bin(original).subarray(v.byteOffset,v.byteOffset+v.byteLength));}}});
test('declared pairs refuse mismatched counts bounds transforms texture tuples and unsafe runtime fields',()=>{const {full,coarse}=publicTexturedLODPair();assert.throws(()=>qualifyApprovedTexturedPair(full,coarse,9,2));assert.throws(()=>qualifyApprovedTexturedPair(coarse,full,2,8));for(const edit of [d=>d.buffers[0].uri='https://invalid.example/b.bin',d=>d.nodes[0].translation=[0,0,1],d=>d.accessors[0].max=[2,1,0],d=>d.extensions={unreviewed:{}},d=>d.materials[0].doubleSided=false,d=>d.samplers[0].minFilter=9987,(_d,b)=>b.writeFloatLE(.375,96),(_d,b)=>b.writeFloatLE(NaN,0),(d,b)=>{const v=d.bufferViews[3];const first=b.readUInt32LE(v.byteOffset+4);b.writeUInt32LE(b.readUInt32LE(v.byteOffset+8),v.byteOffset+4);b.writeUInt32LE(first,v.byteOffset+8);},(d,b)=>b[d.bufferViews[4].byteOffset+40]^=1])assert.throws(()=>qualifyApprovedTexturedPair(full,changeTextureGLB(coarse,edit),8,2));});

test('invalid declared relation is distinct from explicit unsupported profile',()=>{const {full,coarse}=publicTexturedLODPair();assert.throws(()=>qualifyApprovedTexturedPair(full,coarse,9,2),{message:'APPROVED_LOD_INVALID'});const changed=publicTexturedLODPair({png:publicTexturePNG(4,2)}).coarse;assert.throws(()=>qualifyApprovedTexturedPair(full,changed,8,2),{message:'APPROVED_LOD_INVALID'});assert.throws(()=>qualifyApprovedTexturedPair(changeTextureGLB(full,d=>d.nodes[0].translation=[0,0,1]),changeTextureGLB(coarse,d=>d.nodes[0].translation=[0,0,1]),8,2),{message:'APPROVED_LOD_UNSUPPORTED'});});

test('optional public Basis pair genuinely transcodes before approval and preserves compressed and PNG bytes through watermark and declared LOD',async()=>{const pair=publicTexturedLODPair({png:publicTexturePNG(8,8)}),full=withPublicBasis(pair.full),coarse=withPublicBasis(pair.coarse);for(const b of [full,coarse])await decode(b,mime);assert.deepEqual(qualifyApprovedTexturedPair(full,coarse,8,2),{full:{triangles:8,textureSize:8},coarse:{triangles:2,textureSize:8}});const marked=await derivative(full,mime);await decode(marked,mime);assert.deepEqual(parse(marked).textures,parse(full).textures);const bin=b=>b.subarray(28+b.readUInt32LE(12));for(const image of parse(full).images){const v=parse(full).bufferViews[image.bufferView];assert.deepEqual(bin(marked).subarray(v.byteOffset,v.byteOffset+v.byteLength),bin(full).subarray(v.byteOffset,v.byteOffset+v.byteLength));}assert.equal(measureFullVariant(marked,mime).textureSize,8);});
test('valid KTX header with invalid UASTC payload and unsafe optional declarations are never approved',async()=>{const source=withPublicBasis(publicTexturedGLB({png:publicTexturePNG(8,8)}));const broken=publicBasisKtx();broken.fill(255,256);for(let at=256;at<broken.length;at+=16)broken[at]=0x45;await assert.rejects(decode(withPublicBasis(publicTexturedGLB({png:publicTexturePNG(8,8)}),broken),mime));for(const edit of [d=>d.extensionsRequired=['KHR_texture_basisu'],d=>d.extensionsUsed.push('unknown'),d=>d.textures[0].extensions.KHR_texture_basisu.uri='https://invalid.example/a',d=>d.images[1].uri='blob:unsafe',d=>d.textures[0].extensions.KHR_texture_basisu.source=0])await assert.rejects(decode(changeTextureGLB(source,edit),mime));});

test('standard normal/AO maps retain their exact local images and authored tangent frame through display derivative',async()=>{
 for(const [tangents,wrap] of [[true,33071],[false,10497],[true,33648]]) {
  const source=changeTextureGLB(publicPBRTexturedGLB({tangents}),d=>{d.samplers[0].wrapS=wrap;d.samplers[0].wrapT=wrap;}),before=Buffer.from(source);await decode(source,mime);
  const marked=await derivative(source,mime);await decode(marked,mime);const a=parse(source),b=parse(marked),bin=x=>x.subarray(28+x.readUInt32LE(12));
  assert.deepEqual(b.materials.slice(0,a.materials.length),a.materials);assert.deepEqual(b.meshes.slice(0,a.meshes.length),a.meshes);assert.deepEqual(b.textures,a.textures);assert.deepEqual(b.samplers,a.samplers);
  for(const image of a.images){const v=a.bufferViews[image.bufferView];assert.deepEqual(bin(marked).subarray(v.byteOffset,v.byteOffset+v.byteLength),bin(source).subarray(v.byteOffset,v.byteOffset+v.byteLength));}
  assert.deepEqual(source,before);
 }
});
test('normal/AO closed references and optional authored tangent bytes reject malformed or unsupported declarations',async()=>{
 const source=publicPBRTexturedGLB();
 for(const edit of [d=>d.samplers[0].wrapT=0,d=>d.samplers[0].magFilter=9987,d=>d.materials[0].normalTexture.index=9,d=>d.materials[0].normalTexture.scale=2.01,d=>d.materials[0].normalTexture.texCoord=1,d=>d.materials[0].normalTexture.uri='https://invalid.example/map',d=>d.materials[0].occlusionTexture.index=-1,d=>d.materials[0].occlusionTexture.strength=-.01,d=>d.materials[0].occlusionTexture.unknown=true,d=>delete d.meshes[0].primitives[0].attributes.TEXCOORD_0,d=>d.accessors[4].type='VEC3',d=>d.accessors[4].count=3,d=>d.accessors[4].componentType=5123,(d,b)=>b.writeFloatLE(NaN,d.bufferViews[d.accessors[4].bufferView].byteOffset),(d,b)=>b.writeFloatLE(0,d.bufferViews[d.accessors[4].bufferView].byteOffset+12)]) {
  await assert.rejects(decode(changeTextureGLB(source,edit),mime));
 }
});

test('approved PBR LOD pair keeps all maps/scalars/wrap and full optional tangent tuples',async()=>{
 for(const [tangents,wrap]of [[true,10497],[false,33071],[true,33648]]){const {full,coarse}=publicPBRTexturedLODPair({tangents,wrap});await decode(full,mime);await decode(coarse,mime);assert.deepEqual(qualifyApprovedTexturedPair(full,coarse,8,2),{full:{triangles:8,textureSize:2},coarse:{triangles:2,textureSize:2}});}
});
test('PBR LOD refuses changed material/channel bytes and tangent lineage without relaxing existing geometry checks',()=>{
 const {full,coarse}=publicPBRTexturedLODPair();
 assert.throws(()=>qualifyApprovedTexturedPair(full,changeTextureGLB(coarse,d=>d.materials[0].normalTexture=null),8,2),{message:'APPROVED_LOD_UNSUPPORTED'});
 for(const edit of [d=>d.materials[0].roughnessFactor=.5,d=>d.materials[0].pbrMetallicRoughness.roughnessFactor=.5,d=>d.materials[0].normalTexture.scale=.5,d=>d.materials[0].occlusionTexture.strength=.5,d=>d.samplers[0].wrapT=33071,d=>delete d.meshes[0].primitives[0].attributes.TANGENT,(d,b)=>{const t=d.accessors[d.meshes[0].primitives[0].attributes.TANGENT];for(let i=0;i<t.count;i++)b.writeFloatLE(-1,d.bufferViews[t.bufferView].byteOffset+i*16+12);},(d,b)=>b.writeFloatLE(.375,d.bufferViews[d.accessors[2].bufferView].byteOffset),(d,b)=>b[d.bufferViews[d.images[1].bufferView].byteOffset+40]^=1])assert.throws(()=>qualifyApprovedTexturedPair(full,changeTextureGLB(coarse,edit),8,2));
 assert.throws(()=>qualifyApprovedTexturedPair(full,coarse,9,2));assert.throws(()=>qualifyApprovedTexturedPair(coarse,full,2,8));
});

test('sRGB-only Basis textures cannot silently become linear normal/AO maps',async()=>{
 for(const role of ['normalTexture','occlusionTexture']){
  const source=withPublicBasis(changeTextureGLB(publicTexturedGLB({png:publicTexturePNG(8,8),images:3}),d=>{d.materials=[{pbrMetallicRoughness:{baseColorTexture:{index:1},metallicFactor:0,roughnessFactor:1},normalTexture:{index:role==='normalTexture'?0:2},occlusionTexture:{index:role==='occlusionTexture'?0:2},doubleSided:true}];}));
  await assert.rejects(decode(source,mime));
 }
});
test('base-colour and linear maps cannot alias one image through the same or different texture indices',async()=>{
 for(const separateTexture of [false,true]){
  const source=changeTextureGLB(publicTexturedGLB(),d=>{if(separateTexture)d.textures.push({source:0,sampler:0});d.materials[0].normalTexture={index:separateTexture?1:0};});
  await assert.rejects(decode(source,mime));
 }
 const pair=publicTexturedLODPair(),alias=b=>changeTextureGLB(b,d=>{d.textures.push({source:0,sampler:0});d.materials[0].normalTexture={index:1};});
 assert.throws(()=>qualifyApprovedTexturedPair(alias(pair.full),alias(pair.coarse),8,2),{message:'APPROVED_LOD_UNSUPPORTED'});
});


test('packed ORM/AO linear image alias and authored normal/AO strengths survive display without rewriting maps',async()=>{
 for(const [scale,strength] of [[0,0],[.5,.25],[2,1]]){
  const source=changeTextureGLB(publicPBRTexturedGLB(),d=>{const m=d.materials[0];m.normalTexture.scale=scale;m.occlusionTexture.strength=strength;m.pbrMetallicRoughness.metallicRoughnessTexture={index:2};});
  await decode(source,mime);const marked=await derivative(source,mime);await decode(marked,mime);
  assert.deepEqual(parse(marked).materials.slice(0,parse(source).materials.length),parse(source).materials);
  const bin=b=>b.subarray(28+b.readUInt32LE(12));for(const image of parse(source).images){const v=parse(source).bufferViews[image.bufferView];assert.deepEqual(bin(marked).subarray(v.byteOffset,v.byteOffset+v.byteLength),bin(source).subarray(v.byteOffset,v.byteOffset+v.byteLength));}
 }
});
test('approved packed PBR LOD binds exact strengths and all ORM channels, while omitted defaults equal explicit one',async()=>{
 const pair=publicPBRTexturedLODPair(),edit=(b,scale=0,strength=.25)=>changeTextureGLB(b,d=>{const m=d.materials[0];m.normalTexture.scale=scale;m.occlusionTexture.strength=strength;m.pbrMetallicRoughness.metallicRoughnessTexture={index:2};});
 const full=edit(pair.full),coarse=edit(pair.coarse);for(const b of [full,coarse])await decode(b,mime);
 assert.equal(qualifyApprovedTexturedPair(full,coarse,8,2).coarse.triangles,2);
 for(const mismatch of [edit(pair.coarse,.5,.25),edit(pair.coarse,0,0),changeTextureGLB(coarse,(d,b)=>{b[d.bufferViews[d.images[2].bufferView].byteOffset+40]^=1;})])assert.throws(()=>qualifyApprovedTexturedPair(full,mismatch,8,2));
 const absent=changeTextureGLB(pair.coarse,d=>{delete d.materials[0].normalTexture.scale;delete d.materials[0].occlusionTexture.strength;});
 assert.equal(qualifyApprovedTexturedPair(pair.full,absent,8,2).coarse.triangles,2);
});
test('ORM stays within closed PNG/UV0/cap profile and never aliases colour or sRGB-only Basis',async()=>{
 for(const edit of [d=>d.materials[0].pbrMetallicRoughness.metallicRoughnessTexture={index:0},d=>d.materials[0].pbrMetallicRoughness.metallicRoughnessTexture={index:2,texCoord:1},d=>d.materials[0].pbrMetallicRoughness.metallicRoughnessTexture={index:2,scale:1},d=>d.materials[0].pbrMetallicRoughness.metallicRoughnessTexture={index:9},d=>d.materials[0].normalTexture.scale=-.01,d=>d.materials[0].occlusionTexture.strength=1.01])await assert.rejects(decode(changeTextureGLB(publicPBRTexturedGLB(),edit),mime));
 const basis=withPublicBasis(changeTextureGLB(publicTexturedGLB({png:publicTexturePNG(8,8),images:3}),d=>{d.materials=[{pbrMetallicRoughness:{baseColorTexture:{index:1},metallicRoughnessTexture:{index:0}},occlusionTexture:{index:2}}];}));
 await assert.rejects(decode(basis,mime));
 const pair=publicPBRTexturedLODPair(),alias=b=>changeTextureGLB(b,d=>{d.materials[0].pbrMetallicRoughness.metallicRoughnessTexture={index:0};});
 assert.throws(()=>qualifyApprovedTexturedPair(alias(pair.full),alias(pair.coarse),8,2),{message:'APPROVED_LOD_UNSUPPORTED'});
});

test('ORM-only material still requires finite matching UV0 rather than bypassing textured primitive checks',async()=>{
 const source=changeTextureGLB(publicTexturedGLB(),d=>{d.materials[0].pbrMetallicRoughness={metallicRoughnessTexture:{index:0},metallicFactor:.5,roughnessFactor:.75};});
 await decode(source,mime);
 for(const edit of [d=>delete d.meshes[0].primitives[0].attributes.TEXCOORD_0,d=>d.accessors[2].count=3,(d,b)=>b.writeFloatLE(20001,d.bufferViews[d.accessors[2].bufferView].byteOffset)])await assert.rejects(decode(changeTextureGLB(source,edit),mime));
});

test('bounded wrapped UV values preserve authored sampler maps and tangent bytes through display',async()=>{
 for(const wrap of [33071,10497,33648]){
  const source=changeTextureGLB(publicPBRTexturedGLB(),(d,b)=>{d.samplers[0].wrapS=wrap;d.samplers[0].wrapT=wrap;const a=d.accessors[d.meshes[0].primitives[0].attributes.TEXCOORD_0],v=d.bufferViews[a.bufferView];b.writeFloatLE(-.183012709,v.byteOffset);b.writeFloatLE(1.308012724,v.byteOffset+4);});
  await decode(source,mime);const marked=await derivative(source,mime);await decode(marked,mime);
  const a=parse(source),b=parse(marked),bin=x=>x.subarray(28+x.readUInt32LE(12));
  assert.deepEqual(b.samplers,a.samplers);assert.deepEqual(b.textures,a.textures);assert.deepEqual(b.materials.slice(0,a.materials.length),a.materials);
  for(const attribute of ['TEXCOORD_0','TANGENT']){const accessor=a.accessors[a.meshes[0].primitives[0].attributes[attribute]],v=a.bufferViews[accessor.bufferView];assert.deepEqual(bin(marked).subarray(v.byteOffset,v.byteOffset+v.byteLength),bin(source).subarray(v.byteOffset,v.byteOffset+v.byteLength));}
 }
});
test('wrapped UV magnitude stays bounded and malformed sampler or accessor never becomes eligible',async()=>{
 const source=publicPBRTexturedGLB(),editUV=value=>(d,b)=>{const a=d.accessors[d.meshes[0].primitives[0].attributes.TEXCOORD_0],v=d.bufferViews[a.bufferView];b.writeFloatLE(value,v.byteOffset);};
 for(const value of [-20000,20000])await decode(changeTextureGLB(source,editUV(value)),mime);
 for(const edit of [editUV(NaN),editUV(Infinity),editUV(-Infinity),editUV(20001),editUV(-20001),d=>d.samplers[0].wrapS=0,d=>d.accessors[2].count=3])await assert.rejects(decode(changeTextureGLB(source,edit),mime));
});

test('approved wrapped UV pair retains exact tuples and refuses changed lineage or over-cap coordinates',async()=>{
 const pair=publicPBRTexturedLODPair(),wrapped=input=>changeTextureGLB(input,(d,b)=>{const seen=new Set();for(const p of d.meshes[0].primitives){const a=d.accessors[p.attributes.TEXCOORD_0],v=d.bufferViews[a.bufferView];if(seen.has(a.bufferView))continue;seen.add(a.bufferView);for(let i=0;i<a.count*2;i++)b.writeFloatLE(b.readFloatLE(v.byteOffset+i*4)*2-.5,v.byteOffset+i*4);}}),full=wrapped(pair.full),coarse=wrapped(pair.coarse);
 await decode(full,mime);await decode(coarse,mime);assert.equal(qualifyApprovedTexturedPair(full,coarse,8,2).coarse.triangles,2);
 for(const value of [.375,NaN,20001])assert.throws(()=>qualifyApprovedTexturedPair(full,changeTextureGLB(coarse,(d,b)=>b.writeFloatLE(value,d.bufferViews[d.accessors[d.meshes[0].primitives[0].attributes.TEXCOORD_0].bufferView].byteOffset)),8,2));
});

test('nearest magnification retains exact authored sampler/maps through isolated admission display and LOD pair',async()=>{
 for(const magFilter of [9728,9729]){
  const pair=publicPBRTexturedLODPair(),edit=b=>changeTextureGLB(b,d=>{d.samplers[0].magFilter=magFilter;d.materials[0].pbrMetallicRoughness.metallicRoughnessTexture={index:2};}),full=edit(pair.full),coarse=edit(pair.coarse),before=Buffer.from(full);
  for(const bytes of [full,coarse])await decode(bytes,mime);
  assert.equal(qualifyApprovedTexturedPair(full,coarse,8,2).coarse.triangles,2);
  const marked=await derivative(full,mime);await decode(marked,mime);
  const a=parse(full),b=parse(marked),bin=x=>x.subarray(28+x.readUInt32LE(12));
  assert.deepEqual(b.samplers,a.samplers);assert.deepEqual(b.textures,a.textures);assert.deepEqual(b.materials.slice(0,a.materials.length),a.materials);assert.deepEqual(b.meshes.slice(0,a.meshes.length),a.meshes);
  for(const view of a.bufferViews)assert.deepEqual(bin(marked).subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),bin(full).subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength));
  assert.deepEqual(full,before);
 }
});
test('nearest magnification keeps min wrap closed sampler and exact pair correspondence guards',async()=>{
 const pair=publicPBRTexturedLODPair(),nearest=b=>changeTextureGLB(b,d=>{d.samplers[0].magFilter=9728;}),full=nearest(pair.full),coarse=nearest(pair.coarse);
 for(const edit of [d=>d.samplers[0].magFilter=0,d=>d.samplers[0].magFilter=9987,d=>d.samplers[0].magFilter='9728',d=>d.samplers[0].minFilter=9728,d=>d.samplers[0].minFilter=9987,d=>d.samplers[0].wrapS=0,d=>d.samplers[0].extra=true,d=>delete d.samplers[0].magFilter]){
  const bad=changeTextureGLB(coarse,edit);await assert.rejects(decode(bad,mime));assert.throws(()=>qualifyApprovedTexturedPair(full,bad,8,2));
 }
 assert.throws(()=>qualifyApprovedTexturedPair(full,pair.coarse,8,2));
});
