// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {prepareHayesOwnerExchange} from './hayes-owner-exchange.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const binding={version:1,tenantId:id(1),workspaceId:id(2),principalId:id(3),jobId:id(4),leaseId:id(5),attemptId:id(6),runtimeGeneration:id(7),artworkId:id(8),correlationId:id(9),artworkRevision:1,sourceSha256:'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',sourceBytes:8383096};
const nativeOwnerId=id(10),runtimeManifestSha256='a'.repeat(64),challenge=id(11),frame=(x:unknown)=>Buffer.from(JSON.stringify(x));
const output=Buffer.from('generated'),outputSha=createHash('sha256').update(output).digest('hex');
const header=(kind:string,direction:string,bytes:number,sha256:string)=>({version:1,kind,attemptId:binding.attemptId,correlationId:binding.correlationId,direction,bytes,sha256});
function fixture(badAck=false){
 const messages:Buffer[]=[],events:string[]=[],sha=createHash('sha256');let received=0;
 const channel={send:vi.fn(async(raw:Uint8Array)=>{const v=JSON.parse(Buffer.from(raw).toString()) as Record<string,unknown>;
  if(v.kind==='hayes-operation-open'){events.push('open');messages.push(frame({version:1,kind:'hayes-operation-open-accepted',binding,nativeOwnerId,runtimeManifestSha256}));}
  if(v.kind==='hayes-transfer-data'&&v.direction==='source'){expect(v.offset).toBe(received);const part=Buffer.from(String(v.data),'base64');received+=part.length;sha.update(part);}
  if(v.kind==='hayes-transfer-end'&&v.direction==='source'){expect(received).toBe(binding.sourceBytes);expect(sha.digest('hex')).toBe(binding.sourceSha256);events.push('source');messages.push(frame(header('hayes-transfer-accepted','source',received,badAck?'0'.repeat(64):binding.sourceSha256)),frame({version:1,kind:'hayes-operation-revalidate',binding,challenge,runtimeManifestSha256}));}
  if(v.kind==='hayes-operation-revalidated'){events.push('revalidated');messages.push(frame(header('hayes-transfer-start','output',output.length,outputSha)));}
  if(v.kind==='hayes-transfer-next'){if(v.offset===0)messages.push(frame({version:1,kind:'hayes-transfer-data',attemptId:binding.attemptId,correlationId:binding.correlationId,direction:'output',offset:0,data:output.toString('base64')}));else messages.push(frame(header('hayes-transfer-end','output',output.length,outputSha)));}
  if(v.kind==='hayes-transfer-accepted'&&v.direction==='output')events.push('output');
 }),receive:vi.fn(async()=>{const m=messages.shift();if(!m)throw Error('EOF');return m;}),close:vi.fn(async()=>{events.push('close');})};
 const revalidateCommitted=vi.fn(async()=>{events.push('committed');});return {channel,events,revalidateCommitted};
}
describe.skipIf(!process.env.EXHIBITOS_HAYES_ORIGINAL)('exact Hayes exchange sequencing',()=>{
 it('requires source ACK before committed revalidation and output',async()=>{const f=fixture(),source=await readFile(process.env.EXHIBITOS_HAYES_ORIGINAL!),exchange=await prepareHayesOwnerExchange({...f,binding,nativeOwnerId,runtimeManifestSha256,source,signal:new AbortController().signal,deadlineMs:Date.now()+30000});expect(f.events).toEqual(['open','source','committed','revalidated']);const result=await exchange.receiveOutput();expect(result.bytes).toEqual(output);expect(f.events.at(-1)).toBe('output');await exchange.close();expect(f.channel.close).toHaveBeenCalledOnce();source.fill(0);});
 it('never revalidates after a mismatched source ACK',async()=>{const f=fixture(true),source=await readFile(process.env.EXHIBITOS_HAYES_ORIGINAL!);await expect(prepareHayesOwnerExchange({...f,binding,nativeOwnerId,runtimeManifestSha256,source,signal:new AbortController().signal,deadlineMs:Date.now()+30000})).rejects.toThrow();expect(f.revalidateCommitted).not.toHaveBeenCalled();expect(f.channel.close).toHaveBeenCalledOnce();source.fill(0);});
 it('closes once and does not release output when committed revalidation fails',async()=>{const f=fixture(),source=await readFile(process.env.EXHIBITOS_HAYES_ORIGINAL!);f.revalidateCommitted.mockRejectedValueOnce(Error('commit failed'));await expect(prepareHayesOwnerExchange({...f,binding,nativeOwnerId,runtimeManifestSha256,source,signal:new AbortController().signal,deadlineMs:Date.now()+30000})).rejects.toThrow('commit failed');expect(f.events).toEqual(['open','source','close']);expect(f.channel.close).toHaveBeenCalledOnce();source.fill(0);});
});
