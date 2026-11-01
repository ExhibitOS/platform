// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {writePackedOexAssets} from './oex-packed-writer.ts';

interface ReadHandle {
 stat(options:{bigint:true}):Promise<{dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint;isFile():boolean}>;
 read(buffer:Uint8Array,offset:number,length:number,position:number):Promise<{bytesRead:number}>;
}
interface WriteHandle {write(buffer:Uint8Array,offset:number,length:number,position:number):Promise<{bytesWritten:number}>}
interface Entries {keys():IterableIterator<string>;get(path:string):Promise<Uint8Array|undefined>}
type OpenValidated=(file:ReadHandle,prepare:(input:{manifest:unknown;files:Entries})=>Promise<void>)=>Promise<void>;
type Receipt={archiveBytes:number;archiveSha256:string;manifestSha256:string;capacity:number};
const hex=/^[a-f0-9]{64}$/;

/** Fixed-worker core only, not an IPC endpoint. The owner supplies its pinned
 * input/output handles, trusted receipt and the pinned Spec handle validator.
 * It owns closure, durable seal and fsync after actual worker exit. Every error
 * leaves partial output quarantined and must not authorize its promotion. */
export async function preparePackedOex(input:ReadHandle,output:WriteHandle,receipt:Receipt,openValidated:OpenValidated){
 if(!receipt||Object.keys(receipt).sort().join(',')!=='archiveBytes,archiveSha256,capacity,manifestSha256')throw Error('OEX_PACKED_RECEIPT');
 const values=['archiveBytes','archiveSha256','manifestSha256','capacity'].map(key=>Object.getOwnPropertyDescriptor(receipt,key));if(values.some(v=>!v||!('value' in v)))throw Error('OEX_PACKED_RECEIPT');
 const r={archiveBytes:values[0]!.value as number,archiveSha256:values[1]!.value as string,manifestSha256:values[2]!.value as string,capacity:values[3]!.value as number};if(!Number.isSafeInteger(r.archiveBytes)||r.archiveBytes<1||r.archiveBytes>512*1024*1024||!Number.isSafeInteger(r.capacity)||r.capacity<0||r.capacity>512*1024*1024||typeof r.archiveSha256!=='string'||!hex.test(r.archiveSha256)||typeof r.manifestSha256!=='string'||!hex.test(r.manifestSha256))throw Error('OEX_PACKED_RECEIPT');
 const original=await input.stat({bigint:true});if(!original.isFile()||original.size!==BigInt(r.archiveBytes))throw Error('OEX_PACKED_INPUT');
 const check=async()=>{
  const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
  while(offset<r.archiveBytes){const n=await input.read(buffer,0,Math.min(buffer.length,r.archiveBytes-offset),offset);if(!Number.isSafeInteger(n.bytesRead)||n.bytesRead<1||n.bytesRead>Math.min(buffer.length,r.archiveBytes-offset))throw Error('OEX_PACKED_INPUT');h.update(buffer.subarray(0,n.bytesRead));offset+=n.bytesRead;}
  const after=await input.stat({bigint:true});if(after.dev!==original.dev||after.ino!==original.ino||after.size!==original.size||after.mtimeNs!==original.mtimeNs||after.ctimeNs!==original.ctimeNs||h.digest('hex')!==r.archiveSha256)throw Error('OEX_PACKED_INPUT');
 };
 await check();let written:Awaited<ReturnType<typeof writePackedOexAssets>>|undefined;
 await openValidated(input,async({manifest,files})=>{
  const bytes=await files.get('manifest.json');if(!bytes||bytes.byteLength>4*1024*1024||createHash('sha256').update(bytes).digest('hex')!==r.manifestSha256)throw Error('OEX_PACKED_MANIFEST');
  written=await writePackedOexAssets(output,manifest,files,r.capacity);
 });
 if(!written)throw Error('OEX_PACKED_OUTPUT');await check();return written;
}
