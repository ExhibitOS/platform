// SPDX-License-Identifier: AGPL-3.0-or-later
// Sequentially consume only the exact snapshot-derived inventory. No paths or
// allocation sizes from the network are accepted before the full header matches.
export const MATERIAL_BATCH_STREAM_HOLD=8388608+65540;
export async function openWorkspaceMaterialBatch(response,expected,revision){
 const fail=()=>{throw Error('PUBLICATION_UNAVAILABLE');};
 const token=response.headers.get('x-exhibitos-material-batch');
 if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!=='application/vnd.exhibitos.material-maps-v1'||response.headers.get('x-exhibitos-publication-revision')!==revision||!token||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(token)){await response.body?.cancel().catch(()=>{});fail();}
 if(!Array.isArray(expected)||!expected.length||expected.length>192||expected.some(x=>!Number.isSafeInteger(x.bytes)||x.bytes<1||x.bytes>8388608)||expected.reduce((n,x)=>n+x.bytes,0)>64*1024*1024){await response.body.cancel().catch(()=>{});fail();}
 const reader=response.body.getReader();let pending=new Uint8Array(0),closed=false,closing,busy=false,index=0;
 const close=cancel=>{if(closing)return closing;closed=true;closing=(async()=>{try{if(cancel)await reader.cancel();}catch{}finally{reader.releaseLock();}})();return closing;};
 const read=async(size,keep=true)=>{
  const out=keep?new Uint8Array(size):undefined;let at=0;
  while(at<size){if(closed)fail();if(!pending.length){const next=await reader.read();if(closed||next.done)fail();if(!(next.value instanceof Uint8Array)||!next.value.length||next.value.length>MATERIAL_BATCH_STREAM_HOLD)fail();pending=next.value;}
   const count=Math.min(pending.length,size-at);if(out)out.set(pending.subarray(0,count),at);pending=pending.subarray(count);at+=count;
  }
  return out;
 };
 try{
  const prefix=await read(4),headerLength=new DataView(prefix.buffer,prefix.byteOffset,4).getUint32(0);if(headerLength<2||headerLength>65536)fail();
  const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(headerLength)));
  if(!header||Object.keys(header).sort().join(',')!=='records,version'||header.version!==1||!Array.isArray(header.records)||header.records.length!==expected.length)fail();
  for(let i=0;i<expected.length;i++){const record=header.records[i],wanted=expected[i];if(!record||Object.keys(record).sort().join(',')!=='bytes,materialId,role,sha256,version'||record.materialId!==wanted.materialId||record.version!==wanted.version||record.role!==wanted.role||record.sha256!==wanted.sha256||record.bytes!==wanted.bytes)fail();}
  return {token,
   async next(wanted){if(closed||busy)fail();busy=true;try{
    const target=expected.findIndex((v,i)=>i>=index&&v.materialId===wanted.materialId&&v.version===wanted.version&&v.role===wanted.role&&v.sha256===wanted.sha256&&v.bytes===wanted.bytes);if(target<0)fail();
    while(index<target){await read(expected[index].bytes,false);index++;}
    const bytes=await read(expected[index].bytes);index++;
    if(index===expected.length){if(pending.length)fail();const tail=await reader.read();if(closed||!tail.done)fail();await close(false);}
    return bytes;
   }catch(error){await close(true);throw error;}finally{busy=false;}},
   async cancel(){await close(true);}
  };
 }catch(error){await close(true);throw error;}
}
