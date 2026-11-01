// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {packedOexInventory} from './oex-packed-output.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Entry={path:string;offset:number;bytes:number;sha256:string};
type Channel={send(value:Uint8Array):Promise<void>;receive():Promise<Uint8Array>;close():Promise<void>};

/** Inactive, one-entry-at-a-time reader on an already authenticated live
 * owner connection. Caller must first validate the exact Spec manifest/ACK,
 * retain the same Session/fence/reservation, journal destinations before any
 * BlobStore.put and commit only after worker/rights/claim revalidation. This
 * function provides bytes/integrity, not Session or drain authority. */
export async function createPackedOexStreamReceiver(manifest:unknown,input:unknown,attemptId:string,capacity:number,channel:Channel){
 try{
 if(typeof attemptId!=='string'||!uuid.test(attemptId)||!Number.isSafeInteger(capacity)||capacity<0||capacity>512*1024*1024||!Array.isArray(input)||!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function')throw Error('OEX_PACKED_STREAM');
 const expected=packedOexInventory(manifest),items=input as unknown[];if(items.length!==expected.size)throw Error('OEX_PACKED_STREAM');
 const seen=new Set<string>(),entries:Readonly<Entry>[]=[];let total=0;
 for(const item of items){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join(',')!=='bytes,offset,path,sha256')throw Error('OEX_PACKED_STREAM');
  const e=item as Entry,want=expected.get(e.path);if(!want||seen.has(e.path)||e.bytes!==want.bytes||e.sha256!==want.sha256||!Number.isSafeInteger(e.offset)||e.offset!==total||e.bytes>capacity-total)throw Error('OEX_PACKED_STREAM');
  seen.add(e.path);entries.push(Object.freeze({...e}));total+=e.bytes;
 }
 let cursor=0,busy=false,failed=false;
 return Object.freeze({
  totalBytes:total,count:entries.length,
  async readNext(){
   if(failed||busy||cursor>=entries.length){failed=true;await channel.close().catch(()=>{});throw Error('OEX_PACKED_STREAM');}busy=true;
   const entry=entries[cursor]!;let bytes:Buffer|undefined,offset=0;
   try{
    bytes=Buffer.alloc(entry.bytes);
    while(offset<entry.bytes){
     const length=Math.min(4096,entry.bytes-offset),correlationId=randomUUID(),request={version:1,kind:'read-chunk',correlationId,attemptId,index:cursor,offset,length};
     await channel.send(Buffer.from(JSON.stringify(request)));const raw=await channel.receive();if(failed||!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('OEX_PACKED_STREAM');
     const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),value:unknown=JSON.parse(text);
     if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_PACKED_STREAM');const v=value as Record<string,unknown>,keys=['version','kind','correlationId','attemptId','index','offset','data'];
     if(Object.keys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key))||v.version!==1||v.kind!=='chunk-data'||v.correlationId!==correlationId||v.attemptId!==attemptId||v.index!==cursor||v.offset!==offset||typeof v.data!=='string'||text!==JSON.stringify(Object.fromEntries(keys.map(key=>[key,v[key]]))))throw Error('OEX_PACKED_STREAM');
     const part=Buffer.from(v.data,'base64');if(part.length!==length||part.toString('base64')!==v.data)throw Error('OEX_PACKED_STREAM');part.copy(bytes,offset);offset+=part.length;
    }
    if(failed||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('OEX_PACKED_STREAM');cursor++;return {path:entry.path,bytes};
   }catch(error){failed=true;bytes?.fill(0);await channel.close().catch(()=>{});throw error;}finally{busy=false;}
  },
 });
 }catch(error){if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}
}
