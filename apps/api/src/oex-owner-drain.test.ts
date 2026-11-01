// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {requestOexOwnerDrain} from './oex-owner-drain.ts';
const attempt='10000000-0000-4000-8000-000000000001';
it('accepts only the correlated response once, after live checks',async()=>{
 let request={correlationId:''};const channel={send:vi.fn(async(raw:Uint8Array)=>{request=JSON.parse(Buffer.from(raw).toString());}),receive:vi.fn(async()=>Buffer.from(JSON.stringify({version:1,kind:'drain-result',correlationId:request.correlationId,attemptId:attempt,status:'drained'}))),close:vi.fn(async()=>{})},live=vi.fn(async()=>{}),signal=new AbortController().signal;
 await requestOexOwnerDrain(channel,attempt,live,signal);expect(live).toHaveBeenCalledTimes(2);expect(channel.receive).toHaveBeenCalledWith(120000);await expect(requestOexOwnerDrain(channel,attempt,live,signal)).rejects.toThrow('OEX_OWNER_DRAIN');expect(channel.close).toHaveBeenCalledOnce();
});
it('closes on a changed attempt without accepting drain',async()=>{
 const channel={send:vi.fn(async()=>{}),receive:vi.fn(async()=>Buffer.from('{}')),close:vi.fn(async()=>{})};await expect(requestOexOwnerDrain(channel,attempt,async()=>{},new AbortController().signal)).rejects.toThrow('OEX_OWNER_DRAIN');expect(channel.close).toHaveBeenCalledOnce();
});
