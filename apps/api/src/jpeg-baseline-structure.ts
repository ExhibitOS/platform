// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';

/** Conservative single-scan baseline envelope only. This does not decode
 * entropy, attest colour conversion, or grant publication permission. */
export function inspectBaselineJpegStructure(data:Buffer){
 const fail=():never=>{throw Error('JPEG_STRUCTURE_UNSUPPORTED');};
 if(!Buffer.isBuffer(data)||data.length<4||data.length>25*1024*1024||data[0]!==0xff||data[1]!==0xd8)fail();
 let offset=2,width=0,height=0,scan=false,eoi=false;const quant=new Set<number>(),huffman=new Set<string>(),components=new Map<number,number>(),icc=new Map<number,Buffer>();let iccCount=0,iccBytes=0;
 while(offset<data.length){
  if(data[offset++]!==0xff)fail();while(data[offset]===0xff)offset++;if(offset>=data.length)fail();const marker=data[offset++]!;
  if(marker===0xd9){if(!scan||offset!==data.length)fail();eoi=true;break;}
  if(scan||marker===0||marker===0xd8||marker===0x01||marker>=0xd0&&marker<=0xd7||offset+2>data.length)fail();
  const length=data.readUInt16BE(offset);if(length<2||offset+length>data.length)fail();const start=offset+2,end=offset+length;offset=end;
  if(marker===0xdb){let pos=start;while(pos<end){const info=data[pos++]!,id=info&15;if(info>>4||id>3||quant.has(id)||pos+64>end)fail();for(let n=0;n<64;n++)if(!data[pos+n])fail();pos+=64;quant.add(id);}if(pos!==end)fail();}
  else if(marker===0xc4){let pos=start;while(pos<end){const info=data[pos++]!,kind=info>>4,id=info&15,key=`${kind}:${id}`;if(kind>1||id>1||huffman.has(key)||pos+16>end)fail();let count=0,space=1;for(let n=0;n<16;n++){const size=data[pos+n]!;space=space*2-size;if(space<0)fail();count+=size;}pos+=16;if(!space||!count||count>256||pos+count>end)fail();for(let n=0;n<count;n++){const symbol=data[pos+n]!,run=symbol>>4,size=symbol&15;if(kind===0?symbol>11:size>10||size===0&&run!==0&&run!==15)fail();}pos+=count;huffman.add(key);}if(pos!==end)fail();}
  else if(marker===0xc0){if(width||length!==17||data[start]!==8||data[start+5]!==3)fail();height=data.readUInt16BE(start+1);width=data.readUInt16BE(start+3);if(!width||!height||width>8192||height>8192||width*height>16000000)fail();let blocks=0;for(let n=0;n<3;n++){const p=start+6+n*3,id=data[p]!,sampling=data[p+1]!,table=data[p+2]!,horizontal=sampling>>4,vertical=sampling&15;if(components.has(id)||!horizontal||horizontal>4||!vertical||vertical>4||table>3)fail();blocks+=horizontal*vertical;components.set(id,table);}if(blocks>10)fail();}
  else if(marker===0xda){if(!width||length!==12||data[start]!==3||components.size!==3)fail();const seen=new Set<number>();for(let n=0;n<3;n++){const p=start+1+n*2,id=data[p]!,tables=data[p+1]!,q=components.get(id);if(q===undefined||seen.has(id)||!quant.has(q)||!huffman.has(`0:${tables>>4}`)||!huffman.has(`1:${tables&15}`))fail();seen.add(id);}if(data[end-3]!==0||data[end-2]!==63||data[end-1]!==0)fail();scan=true;
   let entropyBytes=0;while(offset<data.length){if(data[offset++]!==0xff){entropyBytes++;continue;}if(offset>=data.length)fail();const next=data[offset++]!;if(next===0){entropyBytes++;continue;}if(next!==0xd9||offset!==data.length||!entropyBytes)fail();eoi=true;break;}break;
  }
  else if(marker===0xe2&&end-start>=12&&data.subarray(start,start+12).equals(Buffer.from('ICC_PROFILE\0','binary'))){if(end-start<=14)fail();const sequence=data[start+12]!,count=data[start+13]!;iccBytes+=end-start-14;if(iccBytes>131072||!count||!sequence||sequence>count||iccCount&&iccCount!==count||icc.has(sequence))fail();iccCount=count;icc.set(sequence,data.subarray(start+14,end));}
  else if(!(marker>=0xe0&&marker<=0xef||marker===0xfe))fail();
 }
 if(!eoi||!scan||!width||!height||icc.size!==iccCount)fail();const profile=Buffer.concat(Array.from({length:iccCount},(_,i)=>icc.get(i+1)??fail()));if(profile.length&&(profile.length<128||profile.readUInt32BE(0)!==profile.length||profile.toString('ascii',36,40)!=='acsp'))fail();
 return {codec:'jpeg' as const,width,height,bitDepth:8,channels:3,frameCount:1,interlaced:false,iccBytes:profile.length,iccSha256:profile.length?createHash('sha256').update(profile).digest('hex'):undefined};
}
