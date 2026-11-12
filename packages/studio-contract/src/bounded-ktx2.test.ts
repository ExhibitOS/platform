// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {boundedKtx2,embeddedBasisPairs,embeddedMippedBasisPairs} from './bounded-ktx2.js';
import {boundedMippedKtx2} from './bounded-mipped-ktx2.js';

// Synthetic structural containers: no encoded block fidelity or PNG decoding claim.
const dfd=Uint8Array.from('2c0000000000000002002800a601020003030000100000000000000000007f000000000000000000ffffffff'.match(/../g)!,x=>parseInt(x,16));
function container(mipped:boolean){
  const count=mipped?10:1,indexEnd=80+24*count,start=Math.ceil((indexEnd+44)/16)*16;
  const sizes=Array.from({length:count},(_,i)=>16*Math.ceil((512/2**i)/4)**2);
  const bytes=new Uint8Array(start+sizes.reduce((a,b)=>a+b,0)),v=new DataView(bytes.buffer);
  bytes.set([171,75,84,88,32,50,48,187,13,10,26,10]);
  for(const [at,n] of [[16,1],[20,512],[24,512],[36,1],[40,count],[48,indexEnd],[52,44]])v.setUint32(at!,n!,true);
  bytes.set(dfd,indexEnd);let offset=start;
  for(let i=count-1;i>=0;i--){v.setBigUint64(80+24*i,BigInt(offset),true);v.setBigUint64(88+24*i,BigInt(sizes[i]!),true);v.setBigUint64(96+24*i,BigInt(sizes[i]!),true);offset+=sizes[i]!;}
  return bytes;
}
function fixture(mipped=true){
  const png=new Uint8Array(24),view=new DataView(png.buffer);view.setUint32(16,512);view.setUint32(20,512);
  const images=[png,container(mipped)];
  const doc={extensionsUsed:['KHR_texture_basisu'],images:[{mimeType:'image/png',bufferView:0},{mimeType:'image/ktx2',bufferView:1}],textures:[{source:0,extensions:{KHR_texture_basisu:{source:1}}}]};
  return {doc,images,read:(index:number)=>images[index]!};
}
it('admits the exact mipped profile with matching embedded PNG dimensions without mutating the document',()=>{
  const f=fixture(),before=structuredClone(f.doc);
  expect(boundedMippedKtx2(f.images[1]!).levelCount).toBe(10);
  expect(embeddedMippedBasisPairs(f.doc,f.read)).toEqual(new Map([[1,0]]));
  expect(f.doc).toEqual(before);
});
it('preserves single-level admission and rejects either profile through the other entry point',()=>{
  const single=fixture(false),mipped=fixture();
  expect(boundedKtx2(single.images[1]!).width).toBe(512);
  expect(embeddedBasisPairs(single.doc,single.read)).toEqual(new Map([[1,0]]));
  expect(()=>embeddedBasisPairs(mipped.doc,mipped.read)).toThrow('KTX2_PROFILE_INVALID');
  expect(()=>embeddedMippedBasisPairs(single.doc,single.read)).toThrow('KTX2_MIPPED_PROFILE_INVALID');
});
it('rejects malformed mip headers before returning any decoder admission',()=>{
  const f=fixture();new DataView(f.images[1]!.buffer).setUint32(40,9,true);
  expect(()=>embeddedMippedBasisPairs(f.doc,f.read)).toThrow('KTX2_MIPPED_PROFILE_INVALID');
});
it('rejects a missing, truncated or differently sized PNG fallback',()=>{
  for(const kind of ['missing','short','dimensions']){
    const f=fixture();
    if(kind==='missing')f.doc.textures[0]!.source=2;
    else if(kind==='short')f.images[0]=new Uint8Array(23);
    else new DataView(f.images[0]!.buffer).setUint32(20,256);
    expect(()=>embeddedMippedBasisPairs(f.doc,f.read)).toThrow('BASIS_GLTF_PROFILE_INVALID');
  }
});
it('rejects duplicate pairs, unpaired compressed images and extra texture extension fields',()=>{
  const duplicate=fixture();duplicate.doc.textures.push(structuredClone(duplicate.doc.textures[0]!));
  const orphan=fixture();orphan.doc.images.push({mimeType:'image/ktx2',bufferView:2});
  const extra=fixture();Object.assign(extra.doc.textures[0]!.extensions.KHR_texture_basisu,{other:1});
  for(const f of [duplicate,orphan,extra])expect(()=>embeddedMippedBasisPairs(f.doc,f.read)).toThrow('BASIS_GLTF_PROFILE_INVALID');
});
it('rejects required extensions and external URIs for both profile entry points',()=>{
  for(const check of [embeddedBasisPairs,embeddedMippedBasisPairs])for(const mutation of [
    (doc:ReturnType<typeof fixture>['doc'])=>Object.assign(doc,{extensionsRequired:['KHR_texture_basisu']}),
    (doc:ReturnType<typeof fixture>['doc'])=>Object.assign(doc.images[0]!,{uri:'fallback.png'}),
    (doc:ReturnType<typeof fixture>['doc'])=>Object.assign(doc,{buffers:[{uri:'external.bin'}]}),
  ]){
    const f=fixture(check===embeddedMippedBasisPairs);mutation(f.doc);
    expect(()=>check(f.doc,f.read)).toThrow('BASIS_GLTF_PROFILE_INVALID');
  }
});
it('keeps optional extension declarations closed, including when no pair is present',()=>{
  for(const extensionsUsed of [[],['KHR_texture_basisu','OTHER'],['OTHER']]){
    const f=fixture();f.doc.extensionsUsed=extensionsUsed;
    expect(()=>embeddedMippedBasisPairs(f.doc,f.read)).toThrow('BASIS_GLTF_PROFILE_INVALID');
  }
  expect(embeddedMippedBasisPairs({images:[],textures:[]},()=>{throw Error('unexpected image read');})).toEqual(new Map());
  expect(()=>embeddedMippedBasisPairs({extensionsUsed:['KHR_texture_basisu']},()=>new Uint8Array())).toThrow('BASIS_GLTF_PROFILE_INVALID');
});
