// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {readOex,writeOex} from '@exhibitos/spec';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {decodeFreezeOex,freezeHash,readFreezeZip} from './freeze-oex';
const fixture=()=>readFile(new URL('../../../node_modules/@exhibitos/spec/oex/v1/examples/synthetic-media.oex',import.meta.url));
describe('bounded frozen OEX parser',()=>{
 it('reads actual public STORE fixture and agrees with independent Spec reader including WAV pointers',async()=>{
  const bytes=await fixture(),reference=await readOex(bytes),hash=await freezeHash(new TextEncoder().encode(freezeCanonical(reference.exhibition)));
  const frozen=await decodeFreezeOex(bytes,hash);expect(frozen.exhibition).toEqual(reference.exhibition);expect(frozen.assets.size).toBe(3);
  for(const a of reference.manifest.assets)expect(frozen.assets.get(a.id)?.bytes).toEqual(new Uint8Array(reference.files.get(a.path)!));
 });
 it('rejects CRC corruption, local-header mismatch, trailing records and unsupported compression',async()=>{
  const bytes=await fixture(),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),central=v.getUint32(bytes.length-6,true);
  for(const mutate of [(b:Uint8Array)=>{b[50]=b[50]!^1;},(b:Uint8Array)=>{b[6]=1;},(b:Uint8Array)=>{b[central+10]=8;}]){const copy=new Uint8Array(bytes);mutate(copy);expect(()=>readFreezeZip(copy)).toThrow();}
  expect(()=>readFreezeZip(new Uint8Array([...bytes,0]))).toThrow();
 });
 it('rejects a valid archive when the signed scene hash differs',async()=>{await expect(decodeFreezeOex(await fixture(),'0'.repeat(64))).rejects.toThrow('OEX_REVISION');});
 it('the independent Spec writer refuses a changed asset with the previous declared hash',async()=>{
  const ref=await readOex(await fixture()),files=new Map(ref.manifest.assets.map(a=>[a.artifactPath,new Uint8Array(ref.files.get(a.path)!)]));
  // A conforming independent writer itself refuses a changed asset with the old inventory hash.
  const data=files.get(ref.manifest.assets[0]!.artifactPath)!;data[15]=data[15]!^1;
  await expect(writeOex(ref.exhibition,files,{createdAt:ref.manifest.createdAt,generator:ref.manifest.generator})).rejects.toThrow();
 });
});
