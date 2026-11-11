// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {boundedMippedKtx2,BOUNDED_MIPPED_KTX2_PROFILE} from './bounded-mipped-ktx2.js';

// Synthetic container only: payload bytes are not an encoder/transcoder fixture.
// Explicit expected sizes make 2×2 and 1×1 full blocks visible independently.
const sizes=[262144,65536,16384,4096,1024,256,64,16,16,16];
const dfd=[44,0,0,0,0,0,0,0,2,0,40,0,166,1,2,0,3,3,0,0,16,0,0,0,0,0,0,0,0,0,127,0,0,0,0,0,0,0,0,0,255,255,255,255];
const pad=(n:number,a:number)=>Math.ceil(n/a)*a;
const encode=new TextEncoder();
function metadata(entries:[string,string][]) {
  const parts=entries.map(([key,value])=>encode.encode(key+'\0'+value+'\0'));
  const result=new Uint8Array(parts.reduce((n,p)=>n+4+pad(p.length,4),0));
  const v=new DataView(result.buffer);let at=0;
  for(const p of parts){v.setUint32(at,p.length,true);result.set(p,at+4);at+=4+pad(p.length,4);}
  return result;
}
function fixture(entries:[string,string][]=[]){
  const kv=metadata(entries),start=pad(364+kv.length,16);
  const bytes=new Uint8Array(start+sizes.reduce((a,b)=>a+b,0)),v=new DataView(bytes.buffer);
  bytes.set([171,75,84,88,32,50,48,187,13,10,26,10]);
  for(const [at,n] of [[16,1],[20,512],[24,512],[36,1],[40,10],[48,320],[52,44],[56,kv.length?364:0],[60,kv.length]])v.setUint32(at!,n!,true);
  bytes.set(dfd,320);bytes.set(kv,364);let offset=start;
  for(let i=9;i>=0;i--){v.setBigUint64(80+i*24,BigInt(offset),true);v.setBigUint64(88+i*24,BigInt(sizes[i]!),true);v.setBigUint64(96+i*24,BigInt(sizes[i]!),true);bytes.fill(i+1,offset,offset+sizes[i]!);offset+=sizes[i]!;}
  return bytes;
}
const bad=(b:Uint8Array)=>expect(()=>boundedMippedKtx2(b)).toThrow('KTX2_MIPPED_PROFILE_INVALID');
const u32=(b:Uint8Array,at:number,n:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,n,true);
const u64=(b:Uint8Array,at:number,n:bigint)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setBigUint64(at,n,true);

describe('closed 512 opaque sRGB UASTC physical mip chain',()=>{
  it('accepts all ten logical levels with reverse physical order and full tiny blocks',()=>{
    expect(boundedMippedKtx2(fixture())).toEqual({profile:BOUNDED_MIPPED_KTX2_PROFILE,width:512,height:512,levelCount:10,levelBytes:sizes});
    const a=boundedMippedKtx2(fixture());a.levelBytes[0]=0;
    expect(boundedMippedKtx2(fixture()).levelBytes).toEqual(sizes);
  });
  it('supports offset Uint8Array views without reading neighbouring bytes',()=>{
    const f=fixture(),backing=new Uint8Array(f.length+32);backing.fill(255);backing.set(f,13);
    expect(boundedMippedKtx2(backing.subarray(13,13+f.length)).levelCount).toBe(10);
  });
  it('accepts bounded writer metadata and minimal zero alignment',()=>{
    expect(boundedMippedKtx2(fixture([['KTXwriter','Synthetic test'],['KTXwriterScParams','--encode uastc']])).levelBytes).toEqual(sizes);
    expect(boundedMippedKtx2(fixture([['KTXwriter','x'.repeat(4081)]]))).toBeDefined(); // exactly 4096 KVD bytes
  });
  it.each([[12,1],[16,2],[20,256],[24,1024],[28,1],[32,1],[36,6],[40,1],[40,9],[40,11],[44,1],[44,2],[48,324],[52,40],[56,364],[60,4]])('refuses unsupported header %i=%i',(at,n)=>{const b=fixture();u32(b,at,n);bad(b);});
  it('checks every identifier byte and the complete DFD, including opaque/sRGB/sample fields',()=>{
    for(let i=0;i<12;i++){const b=fixture();b[i]=b[i]!^1;bad(b);}
    for(let i=0;i<44;i++){const b=fixture();b[320+i]=b[320+i]!^1;bad(b);}
  });
  it.each([64,72])('refuses supercompression global data at %i',at=>{const b=fixture();u64(b,at,1n);bad(b);});
  it('checks every level offset, compressed and uncompressed byte count',()=>{
    for(let i=0;i<10;i++)for(const field of [0,8,16]){
      const b=fixture(),v=new DataView(b.buffer),at=80+i*24+field;
      u64(b,at,v.getBigUint64(at,true)+1n);bad(b);
    }
  });
  it('refuses overlapping, aliased, metadata-pointing, misaligned and overflowing offsets',()=>{
    for(const n of [0n,320n,368n,369n,BigInt(fixture().length),0x100000000n,0xffffffffffffffffn]){const b=fixture();u64(b,80,n);bad(b);}
    const b=fixture();u64(b,80,new DataView(b.buffer).getBigUint64(104,true));bad(b);
    for(const field of [88,96]){const x=fixture();u64(x,field,0xffffffffffffffffn);bad(x);}
  });
  it('refuses base-first physical storage, arbitrary gaps and trailing bytes',()=>{
    const b=fixture();let offset=368;
    for(let i=0;i<10;i++){u64(b,80+i*24,BigInt(offset));offset+=sizes[i]!;}bad(b);
    const f=fixture(),g=new Uint8Array(f.length+16);g.set(f.subarray(0,368));g.set(f.subarray(368),384);
    for(let i=0;i<10;i++)u64(g,80+i*24,new DataView(f.buffer).getBigUint64(80+i*24,true)+16n);bad(g);
    const trailing=new Uint8Array(f.length+1);trailing.set(f);bad(trailing);
  });
  it('refuses truncation at header, index, DFD, metadata, padding and payload boundaries',()=>{
    const f=fixture([['KTXwriter','fixture']]);
    for(const n of [0,12,79,80,319,320,363,364,383,384,f.length-1])bad(f.subarray(0,n));
    bad(new Uint8Array(400000));
  });
  it('refuses metadata duplicates, unknown keys, unsorted keys, parameters without writer and excessive metadata',()=>{
    for(const entries of [
      [['KTXwriter','a'],['KTXwriter','b']], [['KTXorientation','rd']],
      [['KTXwriterScParams','a'],['KTXwriter','b']], [['KTXwriterScParams','a']],
      [['KTXwriter','x'.repeat(4090)]], [['KTXwriter','']], [['KTXwriter','a\0b']], [['KTXwriter','é']],
    ] as [string,string][][])bad(fixture(entries));
  });
  it('refuses invalid metadata ranges, lengths, key terminators, string terminators and padding',()=>{
    for(const [at,n] of [[56,368],[60,0],[60,3],[60,4097],[364,0],[364,0xffffffff]]){
      const b=fixture([['KTXwriter','ab']]);u32(b,at!,n!);bad(b);
    }
    const noKey=fixture([['KTXwriter','ab']]);noKey[377]=65;bad(noKey);
    const noValue=fixture([['KTXwriter','ab']]);noValue[380]=65;bad(noValue);
    const kvPadding=fixture([['KTXwriter','ab']]);kvPadding[381]=1;bad(kvPadding);
    const alignment=fixture();alignment[364]=1;bad(alignment);
  });
  it('does not claim to decode or qualify opaque blocks or image fidelity',()=>{
    const b=fixture();b.fill(0,368);
    expect(boundedMippedKtx2(b).levelCount).toBe(10);
  });
});
