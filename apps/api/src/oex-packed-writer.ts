// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {packedOexInventory} from './oex-packed-output.ts';

interface PackedWriter {write(buffer:Uint8Array,offset:number,length:number,position:number):Promise<{bytesWritten:number}>}
interface ArchiveEntries {keys():IterableIterator<string>;get(path:string):Promise<Uint8Array|undefined>}

/** Inactive worker primitive. Both handles are issued and fenced by the owner;
 * no path, descriptor number or executable comes from an untrusted request.
 * The owner must precreate an empty output and independently sync/close it
 * after the worker has actually exited. A returned manifest is NOT a drain
 * acknowledgement and partial output must be retained on every error. */
export async function writePackedOexAssets(writer:PackedWriter,manifest:unknown,files:ArchiveEntries,capacity:number){
 if(!Number.isSafeInteger(capacity)||capacity<0||capacity>512*1024*1024)throw Error('OEX_PACKED_OUTPUT');
 const expected=packedOexInventory(manifest),paths:string[]=[];let visited=0;
 for(const path of files.keys()){if(++visited>256||typeof path!=='string'||path.length>1024)throw Error('OEX_PACKED_OUTPUT');if(path==='manifest.json'||path==='exhibition.json')continue;if(paths.length>=254)throw Error('OEX_PACKED_OUTPUT');paths.push(path);}
 if(paths.length!==expected.size||new Set(paths).size!==paths.length||paths.some(path=>!expected.has(path)))throw Error('OEX_PACKED_OUTPUT');
 const total=[...expected.values()].reduce((sum,item)=>sum+item.bytes,0);if(total>capacity)throw Error('OEX_PACKED_OUTPUT');
 let position=0;const written:{path:string;offset:number;bytes:number;sha256:string}[]=[];
 for(const path of paths){
  const entry=expected.get(path)!,source=await files.get(path);if(!source||source.byteLength!==entry.bytes)throw Error('OEX_PACKED_OUTPUT');
  const bytes=Buffer.from(source);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('OEX_PACKED_OUTPUT');
  let offset=0;while(offset<bytes.length){const result=await writer.write(bytes,offset,bytes.length-offset,position+offset);if(!Number.isSafeInteger(result.bytesWritten)||result.bytesWritten<1||result.bytesWritten>bytes.length-offset)throw Error('OEX_PACKED_OUTPUT');offset+=result.bytesWritten;}
  written.push({path,offset:position,bytes:bytes.length,sha256:entry.sha256});position+=bytes.length;
 }
 return written;
}
