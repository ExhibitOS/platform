// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {verifyBasisPayload,verifyGpuModelBasisPayload} from './basis-payload.ts';
// Structural containers only. Positive payload proof uses the retained genuine
// candidate in the affected CPU verification receipt, not these zero blocks.
function container(levels:1|10){
 const end=80+24*levels,start=Math.ceil((end+44)/16)*16;
 const sizes=Array.from({length:levels},(_,i)=>16*Math.ceil((512/2**i)/4)**2);
 const bytes=new Uint8Array(start+sizes.reduce((a,b)=>a+b,0)),v=new DataView(bytes.buffer);
 bytes.set([171,75,84,88,32,50,48,187,13,10,26,10]);
 for(const [at,n] of [[16,1],[20,512],[24,512],[36,1],[40,levels],[48,end],[52,44]])v.setUint32(at!,n!,true);
 bytes.set(Uint8Array.from('2c0000000000000002002800a601020003030000100000000000000000007f000000000000000000ffffffff'.match(/../g)!,x=>parseInt(x,16)),end);
 let offset=start;
 for(let i=levels-1;i>=0;i--){v.setBigUint64(80+24*i,BigInt(offset),true);v.setBigUint64(88+24*i,BigInt(sizes[i]!),true);v.setBigUint64(96+24*i,BigInt(sizes[i]!),true);offset+=sizes[i]!;}
 return bytes;
}
it('never admits ten-level GPU containers through the legacy one-level entry',async()=>{
 await expect(verifyBasisPayload(container(10))).rejects.toThrow('KTX2_PROFILE_INVALID');
});
it('rejects legacy or malformed mip declarations before GPU payload decoding',async()=>{
 await expect(verifyGpuModelBasisPayload(container(1))).rejects.toThrow('KTX2_MIPPED_PROFILE_INVALID');
 for(const [at,value] of [[40,9],[20,256],[44,1],[52,40]]){
  const bytes=container(10);new DataView(bytes.buffer).setUint32(at!,value!,true);
  await expect(verifyGpuModelBasisPayload(bytes)).rejects.toThrow('KTX2_MIPPED_PROFILE_INVALID');
 }
});
