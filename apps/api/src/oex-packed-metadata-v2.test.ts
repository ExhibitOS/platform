// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {receivePackedOexMetadataV2} from './oex-packed-metadata-v2.ts';
const id='10000000-0000-4000-8000-000000000001',attempt='10000000-0000-4000-8000-000000000002';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const data=Buffer.alloc(5000,0x61),announcement=Buffer.from(JSON.stringify({version:1,kind:'metadata-ready',correlationId:id,attemptId:attempt,bytes:data.length,sha256:hash(data)}));
 let request:{correlationId:string;attemptId:string;offset:number;length:number};
 const channel={send:vi.fn(async(raw:Uint8Array)=>{request=JSON.parse(Buffer.from(raw).toString());}),receive:vi.fn(async()=>Buffer.from(JSON.stringify({version:1,kind:'metadata-chunk',correlationId:request.correlationId,attemptId:request.attemptId,offset:request.offset,data:data.subarray(request.offset,request.offset+request.length).toString('base64')}))),close:vi.fn(async()=>{})};
 return {data,announcement,channel};
}
it('receives exact bytes in deterministic bounded sequential chunks',async()=>{
 const f=fixture();expect(await receivePackedOexMetadataV2(f.channel,f.announcement,id,attempt)).toEqual(f.data);
 const sent=f.channel.send.mock.calls.map(([raw])=>JSON.parse(Buffer.from(raw).toString()) as {offset:number;length:number});expect(sent.map(x=>[x.offset,x.length])).toEqual([[0,4096],[4096,904]]);expect(f.channel.close).not.toHaveBeenCalled();
});
it('closes on altered data, noncanonical response or invalid announcement',async()=>{
 const a=fixture();a.data[0]=0;await expect(receivePackedOexMetadataV2(a.channel,a.announcement,id,attempt)).rejects.toThrow('OEX_PACKED_METADATA');expect(a.channel.close).toHaveBeenCalledOnce();
 const b=fixture();b.channel.receive.mockResolvedValueOnce(Buffer.from('{"version":1,"version":1}'));await expect(receivePackedOexMetadataV2(b.channel,b.announcement,id,attempt)).rejects.toThrow('OEX_PACKED_METADATA');expect(b.channel.close).toHaveBeenCalledOnce();
 const c=fixture(),wrong=Buffer.from(JSON.stringify({version:1,kind:'metadata-ready',correlationId:id,attemptId:attempt,bytes:4194305,sha256:hash(c.data)}));await expect(receivePackedOexMetadataV2(c.channel,wrong,id,attempt)).rejects.toThrow('OEX_PACKED_METADATA');expect(c.channel.send).not.toHaveBeenCalled();expect(c.channel.close).toHaveBeenCalledOnce();
});
