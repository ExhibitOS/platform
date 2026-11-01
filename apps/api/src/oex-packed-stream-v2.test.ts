// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createPackedOexStreamReceiver} from './oex-packed-stream-v2.ts';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),attempt='11111111-1111-4111-8111-111111111111';
function fixture(){
 const files=[Buffer.alloc(9000,17),Buffer.from('tail')];let offset=0;
 const entries=files.map((b,i)=>{const e={path:`assets/${i}`,offset,bytes:b.length,sha256:sha(b)};offset+=b.length;return e;});
 const manifest={formatVersion:'1.0.0-draft.9',assets:entries.map(({path,bytes,sha256})=>({path,bytes,sha256}))};let request:{correlationId:string;attemptId:string;index:number;offset:number;length:number};
 const channel={send:vi.fn(async(b:Uint8Array)=>{request=JSON.parse(Buffer.from(b).toString());}),receive:vi.fn(async()=>Buffer.from(JSON.stringify({version:1,kind:'chunk-data',correlationId:request.correlationId,attemptId:request.attemptId,index:request.index,offset:request.offset,data:files[request.index]!.subarray(request.offset,request.offset+request.length).toString('base64')}))),close:vi.fn(async()=>{})};
 return {files,entries,manifest,channel};
}
it('receives one bounded entry at a time and verifies exact bytes and hash',async()=>{
 const f=fixture(),reader=await createPackedOexStreamReceiver(f.manifest,f.entries,attempt,20000,f.channel);
 expect(await reader.readNext()).toEqual({path:'assets/0',bytes:f.files[0]});expect(await reader.readNext()).toEqual({path:'assets/1',bytes:f.files[1]});expect(f.channel.send).toHaveBeenCalledTimes(4);
});
it('refuses a reordered response and closes without returning bytes',async()=>{
 const f=fixture();f.channel.receive.mockResolvedValueOnce(Buffer.from('{"version":1,"kind":"chunk-data","correlationId":"wrong"}'));const reader=await createPackedOexStreamReceiver(f.manifest,f.entries,attempt,20000,f.channel);
 await expect(reader.readNext()).rejects.toThrow();expect(f.channel.close).toHaveBeenCalledOnce();await expect(reader.readNext()).rejects.toThrow();
});
it('rejects inventory gaps before any request and closes the channel',async()=>{
 const f=fixture();await expect(createPackedOexStreamReceiver(f.manifest,[f.entries[0],{...f.entries[1]!,offset:1}],attempt,20000,f.channel)).rejects.toThrow('OEX_PACKED_STREAM');expect(f.channel.send).not.toHaveBeenCalled();expect(f.channel.close).toHaveBeenCalledOnce();
});
it('rejects correctly framed altered bytes at the final digest',async()=>{
 const f=fixture();f.files[0]![0]^=1;const reader=await createPackedOexStreamReceiver(f.manifest,f.entries,attempt,20000,f.channel);
 await expect(reader.readNext()).rejects.toThrow('OEX_PACKED_STREAM');expect(f.channel.close).toHaveBeenCalledOnce();
});
it('closes on concurrent reads and never returns an in-flight entry',async()=>{
 const f=fixture();let release!:(value:Buffer)=>void;f.channel.receive.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const reader=await createPackedOexStreamReceiver(f.manifest,f.entries,attempt,20000,f.channel);
 const first=reader.readNext();await Promise.resolve();await expect(reader.readNext()).rejects.toThrow('OEX_PACKED_STREAM');release(Buffer.from('{}'));await expect(first).rejects.toThrow();expect(f.channel.close).toHaveBeenCalled();
});
