// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {preparePackedOex} from './oex-packed-worker-core.ts';
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const archive=Buffer.from('archive'),asset=Buffer.from('asset'),manifestBytes=Buffer.from('{"formatVersion":"1.0.0-draft.9"}'),manifest={formatVersion:'1.0.0-draft.9',assets:[{path:'assets/a',bytes:asset.length,sha256:sha(asset)}]};
 const stat={dev:1n,ino:2n,size:BigInt(archive.length),mtimeNs:1n,ctimeNs:1n,isFile:()=>true};
 const input={stat:async()=>stat,read:async(buffer:Uint8Array,offset:number,length:number,position:number)=>{const part=archive.subarray(position,position+length);buffer.set(part,offset);return {bytesRead:part.length};}};
 const packed=Buffer.alloc(asset.length),output={write:async(bytes:Uint8Array,offset:number,length:number,position:number)=>{packed.set(bytes.subarray(offset,offset+length),position);return {bytesWritten:length};}};
 const entries=new Map([['manifest.json',manifestBytes],['assets/a',asset]]),files={keys:()=>entries.keys(),get:async(path:string)=>entries.get(path)};
 const openValidated:Parameters<typeof preparePackedOex>[3]=async(_input,cb)=>cb({manifest,files});
 return {input,output,archive,manifestBytes,packed,openValidated,receipt:{archiveBytes:archive.length,archiveSha256:sha(archive),manifestSha256:sha(manifestBytes),capacity:64}};
}
it('packs only after source and trusted manifest digests match',async()=>{
 const f=fixture(),entries=await preparePackedOex(f.input,f.output,f.receipt,f.openValidated);expect(f.packed.toString()).toBe('asset');expect(entries).toEqual([{path:'assets/a',offset:0,bytes:5,sha256:sha(Buffer.from('asset'))}]);
});
it('rejects wrong archive or expected manifest before writing',async()=>{
 const a=fixture();await expect(preparePackedOex(a.input,a.output,{...a.receipt,archiveSha256:'0'.repeat(64)},a.openValidated)).rejects.toThrow('OEX_PACKED_INPUT');expect(a.packed.equals(Buffer.alloc(5))).toBe(true);
 const b=fixture();await expect(preparePackedOex(b.input,b.output,{...b.receipt,manifestSha256:'0'.repeat(64)},b.openValidated)).rejects.toThrow('OEX_PACKED_MANIFEST');expect(b.packed.equals(Buffer.alloc(5))).toBe(true);
});
it('rejects input that changes while the validated callback is running',async()=>{
 const f=fixture();const mutate:typeof f.openValidated=async(input,cb)=>{await f.openValidated(input,cb);f.archive[0]=0;};await expect(preparePackedOex(f.input,f.output,f.receipt,mutate)).rejects.toThrow('OEX_PACKED_INPUT');
});
