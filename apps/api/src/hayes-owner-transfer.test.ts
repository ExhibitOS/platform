// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {describe,expect,it,vi} from 'vitest';
import {createHayesOwnerTransfer} from './hayes-owner-transfer.ts';
const attemptId='10000000-0000-4000-8000-000000000001',correlationId='20000000-0000-4000-8000-000000000002';
const sourceSha='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6';
const sha=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
const frame=(x:unknown)=>Buffer.from(JSON.stringify(x));
const header=(kind:string,direction:string,bytes:number,sha256:string)=>({version:1,kind,attemptId,correlationId,direction,bytes,sha256});
function fixture(options:{badOutput?:'offset'|'base64'|'digest'|'end'|'extra'|'short';badAck?:boolean}={}){
 const output=Buffer.alloc(5000,42),hash=sha(output),messages:Buffer[]=[],sent:Array<Record<string,unknown>>=[],received=createHash('sha256');let count=0,sourceOffset=0;
 const h=options.badOutput==='digest'?'1'.repeat(64):hash;
 const channel={send:vi.fn(async(raw:Uint8Array)=>{
  const v=JSON.parse(Buffer.from(raw).toString()) as Record<string,unknown>;sent.push(v);
  if(v.kind==='hayes-transfer-data'&&v.direction==='source'){expect(v.offset).toBe(sourceOffset);const part=Buffer.from(String(v.data),'base64');sourceOffset+=part.length;received.update(part);count++;}
  if(v.kind==='hayes-transfer-end'&&v.direction==='source'){
   expect(sourceOffset).toBe(8383096);expect(received.digest('hex')).toBe(sourceSha);
   messages.push(frame(header('hayes-transfer-accepted','source',8383096,options.badAck?'0'.repeat(64):sourceSha)),frame(header('hayes-transfer-start','output',output.length,h)));
  }
  if(v.kind==='hayes-transfer-next'){
   expect(Object.keys(v)).toEqual(['version','kind','attemptId','correlationId','direction','offset']);expect(v.direction).toBe('output');expect(messages).toHaveLength(0);
   const offset=Number(v.offset);
   if(offset<output.length){const data=output.subarray(offset,offset+4096).toString('base64');messages.push(frame({version:1,kind:'hayes-transfer-data',attemptId,correlationId,direction:'output',offset:options.badOutput==='offset'&&offset===0?1:offset,data:options.badOutput==='base64'&&offset===0?data+'\n':data,...(options.badOutput==='extra'&&offset===0?{extra:true}:{})}));}
   else if(options.badOutput!=='short')messages.push(frame(header('hayes-transfer-end','output',output.length,options.badOutput==='end'?'0'.repeat(64):h)));
  }
 }),receive:vi.fn(async()=>{const x=messages.shift();if(!x)throw Error('EOF');return x;}),close:vi.fn(async()=>{})};
 return {channel,output,sent,getCount:()=>count};
}
const make=(channel:ReturnType<typeof fixture>['channel'],signal=new AbortController().signal)=>createHayesOwnerTransfer({attemptId,correlationId,channel,signal,deadlineMs:Date.now()+30000});
it('rejects invalid identity and source before sending any bytes',async()=>{const f=fixture();expect(()=>createHayesOwnerTransfer({attemptId:'bad',correlationId,channel:f.channel,signal:new AbortController().signal,deadlineMs:Date.now()+1000})).toThrow();const t=make(f.channel);await expect(t.sendSource(Buffer.from('wrong'))).rejects.toThrow('HAYES_TRANSFER_INVALID');expect(f.channel.send).not.toHaveBeenCalled();expect(f.channel.close).toHaveBeenCalledOnce();});
describe.skipIf(!process.env.EXHIBITOS_HAYES_ORIGINAL)('exact original bounded owner exchange',()=>{
 async function original(){return readFile(process.env.EXHIBITOS_HAYES_ORIGINAL!);}
 it('sends exact source in ordered chunks and verifies output and explicit acknowledgement',async()=>{const f=fixture(),t=make(f.channel),src=await original();await t.sendSource(src);const result=await t.receiveOutput();expect(result.bytes).toEqual(f.output);expect(result.sha256).toBe(sha(f.output));expect(f.getCount()).toBe(Math.ceil(8383096/4096));expect(f.channel.close).not.toHaveBeenCalled();expect(f.sent.filter(v=>v.kind==='hayes-transfer-next').map(v=>v.offset)).toEqual([0,4096,5000]);expect(f.sent.at(-1)).toEqual(header('hayes-transfer-accepted','output',5000,sha(f.output)));expect(src.length).toBe(8383096);});
 it.each(['offset','base64','digest','end','extra','short'] as const)('closes on malformed output %s',async badOutput=>{const f=fixture({badOutput}),t=make(f.channel);await t.sendSource(await original());await expect(t.receiveOutput()).rejects.toThrow();expect(f.channel.close).toHaveBeenCalledOnce();});
 it('does not start output after a changed source acknowledgement',async()=>{const f=fixture({badAck:true}),t=make(f.channel);await expect(t.sendSource(await original())).rejects.toThrow();expect(f.channel.close).toHaveBeenCalledOnce();});
 it('rejects abort racing with the final output acknowledgement',async()=>{const f=fixture(),abort=new AbortController(),send=f.channel.send.getMockImplementation()!;f.channel.send.mockImplementation(async raw=>{await send(raw);const v=JSON.parse(Buffer.from(raw).toString()) as {kind:string;direction:string};if(v.kind==='hayes-transfer-accepted'&&v.direction==='output')queueMicrotask(()=>queueMicrotask(()=>queueMicrotask(()=>queueMicrotask(()=>abort.abort()))));});const t=make(f.channel,abort.signal);await t.sendSource(await original());await expect(t.receiveOutput()).rejects.toThrow();expect(f.channel.close).toHaveBeenCalledOnce();});
 it('uses one close when a second operation races a pending send',async()=>{const f=fixture();let release!:()=>void;f.channel.send.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));const t=make(f.channel),first=t.sendSource(await original());await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await expect(t.receiveOutput()).rejects.toThrow();release();await expect(first).rejects.toThrow();expect(f.channel.close).toHaveBeenCalledOnce();});
 it('does not mutate a transport-owned frame when an unfinished send is aborted',async()=>{const f=fixture(),abort=new AbortController();let held:Uint8Array|undefined;f.channel.send.mockImplementationOnce(async()=>{}).mockImplementationOnce(raw=>{held=raw;return new Promise<void>(()=>{});});const t=make(f.channel,abort.signal),src=await original(),pending=t.sendSource(src);await vi.waitFor(()=>expect(held).toBeDefined());abort.abort();await expect(pending).rejects.toThrow();const data=JSON.parse(Buffer.from(held!).toString()) as {offset:number;data:string};expect(data.offset).toBe(0);expect(Buffer.from(data.data,'base64')).toEqual(src.subarray(0,4096));expect(f.channel.close).toHaveBeenCalledOnce();});
 it('closes on abort during an unfinished source frame',async()=>{const f=fixture(),abort=new AbortController();f.channel.send.mockImplementationOnce(()=>new Promise(()=>{}));const t=make(f.channel,abort.signal),pending=t.sendSource(await original());setTimeout(()=>abort.abort(),5);await expect(pending).rejects.toThrow();expect(f.channel.close).toHaveBeenCalledOnce();});
});
