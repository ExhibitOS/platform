// SPDX-License-Identifier: AGPL-3.0-or-later
/** Closed structural producer profile; does not validate UASTC blocks by transcoding.
 * KTX 2.0.4 §§2, 3.7, 3.9.7, 3.10, 3.11, 3.13:
 * https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
 * DFD UASTC RGB / 4×4 / 128 bits: KDFS 1.4 §5.6.14 and chapter 25:
 * https://registry.khronos.org/DataFormat/specs/1.4/dataformat.1.4.html
 * This profile intentionally does not change boundedKtx2's one-level contract.
 */
export const BOUNDED_MIPPED_KTX2_PROFILE='opaque-uastc-srgb-512-mipped-v1' as const;
const IDENTIFIER=[171,75,84,88,32,50,48,187,13,10,26,10];
// Basic DFD v2, UASTC=166, BT709 primaries=1, sRGB transfer=2, straight RGB;
// one 128-bit RGB sample, 4×4×1×1 block, bytesPlane[0]=16, UNORM bounds.
const DFD=Uint8Array.from('2c0000000000000002002800a601020003030000100000000000000000007f000000000000000000ffffffff'.match(/../g)!,x=>parseInt(x,16));
const LEVEL_BYTES=Array.from({length:10},(_,i)=>16*Math.ceil((512/2**i)/4)**2);
const PAYLOAD_BYTES=LEVEL_BYTES.reduce((sum,n)=>sum+n,0);
const INDEX_END=80+10*24;
const METADATA_LIMIT=4096;
const align=(n:number,alignment:number)=>Math.ceil(n/alignment)*alignment;
export interface BoundedMippedKtx2Info {
  profile:typeof BOUNDED_MIPPED_KTX2_PROFILE;
  width:512;height:512;levelCount:10;
  /** Logical level order, 512×512 through 1×1, excluding container padding. */
  levelBytes:number[];
}
export function boundedMippedKtx2(bytes:Uint8Array):BoundedMippedKtx2Info {
  const bad=():never=>{throw Error('KTX2_MIPPED_PROFILE_INVALID');};
  // Even the smallest image occupies a complete 16-byte block. Metadata and
  // initial alignment are bounded; no trailing bytes or unexplained gaps.
  if(bytes.byteLength<align(INDEX_END+DFD.length,16)+PAYLOAD_BYTES||
    bytes.byteLength>align(INDEX_END+DFD.length+METADATA_LIMIT,16)+PAYLOAD_BYTES)bad();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u32=(at:number)=>view.getUint32(at,true);
  const u64=(at:number)=>{
    const value=view.getBigUint64(at,true);
    // Bound before conversion/addition, including offsets with high 32 bits set.
    if(value>BigInt(bytes.byteLength))bad();return Number(value);
  };
  if(!IDENTIFIER.every((n,i)=>bytes[i]===n)||u32(12)!==0||u32(16)!==1||
    u32(20)!==512||u32(24)!==512||u32(28)!==0||u32(32)!==0||
    u32(36)!==1||u32(40)!==10||u32(44)!==0||u64(64)!==0||u64(72)!==0)bad();
  if(u32(48)!==INDEX_END||u32(52)!==DFD.length||
    !DFD.every((n,i)=>bytes[INDEX_END+i]===n))bad();
  let end=INDEX_END+DFD.length;
  const kvd=u32(56),kvdLength=u32(60);
  if(kvdLength){
    if(kvd!==end||kvdLength>METADATA_LIMIT||kvdLength%4||kvd+kvdLength>bytes.length)bad();
    const limit=kvd+kvdLength,keys=new Set<string>();let previous='';
    while(end<limit){
      if(end+4>limit)bad();const length=u32(end);end+=4;
      if(length===0||length>limit-end)bad();
      const entry=bytes.subarray(end,end+length),nul=entry.indexOf(0);
      if(nul<1)bad();
      const key=String.fromCharCode(...entry.subarray(0,nul));
      if(!['KTXwriter','KTXwriterScParams'].includes(key)||keys.has(key)||key<=previous)bad();
      // A deliberately closed printable ASCII subset of the specified UTF-8
      // writer strings, with exactly one terminal NUL and a nonempty value.
      const value=entry.subarray(nul+1);
      if(value.length<2||value[value.length-1]!==0||value.subarray(0,-1).some(n=>n<32||n>126))bad();
      keys.add(key);previous=key;end+=length;
      const padded=align(end,4);if(padded>limit||bytes.subarray(end,padded).some(n=>n!==0))bad();end=padded;
    }
    if(end!==limit||keys.has('KTXwriterScParams')&&!keys.has('KTXwriter'))bad();
  }else if(kvd!==0)bad();
  const first=align(end,16);
  if(bytes.subarray(end,first).some(n=>n!==0))bad();
  end=first;
  // Index entries are base-first, but physical image data is smallest-first.
  // Exact contiguous aligned ranges also exclude overlap with metadata, gaps,
  // aliases, reordered levels and extra payload. All lengths include ceil blocks.
  for(let level=9;level>=0;level--){
    const at=80+level*24,offset=u64(at),length=u64(at+8),uncompressed=u64(at+16);
    if(offset!==end||offset%16||length!==LEVEL_BYTES[level]||uncompressed!==length||length>bytes.length-offset)bad();
    end+=length;
  }
  if(end!==bytes.length)bad();
  return {profile:BOUNDED_MIPPED_KTX2_PROFILE,width:512,height:512,levelCount:10,levelBytes:[...LEVEL_BYTES]};
}
