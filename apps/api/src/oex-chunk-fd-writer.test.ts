// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {mkdtemp,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeOexChunkHandles} from './oex-chunk-fd-writer.ts';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const data=Buffer.from('synthetic archive bytes'),packed=Buffer.alloc(data.length);let size=0,sourceGeneration=1n;
 const source={stat:async()=>({dev:1n,ino:2n,size:BigInt(data.length),mtimeNs:sourceGeneration,ctimeNs:sourceGeneration,isFile:()=>true}),read:async(buffer:Uint8Array,offset:number,length:number,position:number)=>{const part=data.subarray(position,position+Math.min(length,4));buffer.set(part,offset);return {bytesRead:part.length};}};
 const stage={stat:async()=>({dev:1n,ino:3n,size:BigInt(size),mtimeNs:1n,ctimeNs:1n,isFile:()=>true}),write:async(buffer:Uint8Array,offset:number,length:number,position:number)=>{const n=Math.min(length,2);packed.set(buffer.subarray(offset,offset+n),position);size=Math.max(size,position+n);return {bytesWritten:n};}};
 return {data,packed,source,stage,expected:[{device:'1',inode:'2',bytes:data.length}],identity:{device:'1',inode:'3'},mutate:()=>{sourceGeneration++;},size:()=>size};
}
it('streams ordered bytes through short reads and writes with the expected input digest',async()=>{const f=fixture();await expect(writeOexChunkHandles([f.source],f.stage,f.expected,f.data.length,sha(f.data),f.identity)).resolves.toEqual({bytes:f.data.length,inputSha256:sha(f.data)});expect(f.packed).toEqual(f.data);});
it('rejects wrong source identity before writing',async()=>{const f=fixture();await expect(writeOexChunkHandles([f.source],f.stage,[{...f.expected[0]!,inode:'4'}],f.data.length,sha(f.data),f.identity)).rejects.toThrow('OEX_CHUNK_SOURCE');expect(f.size()).toBe(0);});
it('rejects changed source or wrong archive digest and leaves partial stage to its owner',async()=>{const f=fixture(),read=f.source.read;f.source.read=async(...args)=>{const result=await read(...args);f.mutate();return result;};await expect(writeOexChunkHandles([f.source],f.stage,f.expected,f.data.length,sha(f.data),f.identity)).rejects.toThrow('OEX_CHUNK_SOURCE');expect(f.size()).toBeGreaterThan(0);const g=fixture();await expect(writeOexChunkHandles([g.source],g.stage,g.expected,g.data.length,'0'.repeat(64),g.identity)).rejects.toThrow('OEX_CHUNK_DIGEST');expect(g.size()).toBe(g.data.length);});
it('snapshots handles and identities before asynchronous stage access',async()=>{const f=fixture(),handles=[f.source],stat=f.stage.stat;f.stage.stat=async()=>{handles.pop();f.expected[0]!.inode='99';f.identity.inode='99';return stat();};await expect(writeOexChunkHandles(handles,f.stage,f.expected,f.data.length,sha(f.data),f.identity)).resolves.toEqual({bytes:f.data.length,inputSha256:sha(f.data)});expect(f.packed).toEqual(f.data);});
it('streams two real file handles in order into the same stage',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'exhibitos-oex-chunks-'));const first=await open(join(dir,'first'),'wx+',0o600),second=await open(join(dir,'second'),'wx+',0o600),stage=await open(join(dir,'stage'),'wx+',0o600);
 try{const a=Buffer.alloc(16*1024*1024,0x61),b=Buffer.from('end');await first.writeFile(a);await second.writeFile(b);const stats=await Promise.all([first.stat({bigint:true}),second.stat({bigint:true}),stage.stat({bigint:true})]),source=[{device:String(stats[0]!.dev),inode:String(stats[0]!.ino),bytes:a.length},{device:String(stats[1]!.dev),inode:String(stats[1]!.ino),bytes:b.length}],hash=createHash('sha256').update(a).update(b).digest('hex');await expect(writeOexChunkHandles([first,second],stage,source,a.length+b.length,hash,{device:String(stats[2]!.dev),inode:String(stats[2]!.ino)})).resolves.toEqual({bytes:a.length+b.length,inputSha256:hash});const actual=await stage.readFile();expect(sha(actual)).toBe(hash);}finally{await Promise.all([first.close(),second.close(),stage.close()]);await rm(dir,{recursive:true});}
},20000);
