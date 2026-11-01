// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {acceptOexOwnerStage} from './oex-owner-stage.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const frame={version:1,kind:'stage-bound',correlationId:id(1),runtimeGeneration:id(2),workspaceId:id(3),tenantId:id(4),jobId:id(5),attemptId:id(6),generation:id(7),stageId:id(8),reservationId:id(9),reservationGeneration:id(10),stageDevice:'12',stageInode:'34'};
const {version:_v,kind:_k,stageInode:_i,...identity}=frame;
const channel=()=>({send:vi.fn(async(_bytes:Uint8Array)=>{}),close:vi.fn(async()=>{})});
it('acknowledges only an exact stage tied to the live claim and reserved device',async()=>{
 const c=channel(),verify=vi.fn(async()=>{});expect(await acceptOexOwnerStage(c,Buffer.from(JSON.stringify(frame)),identity,verify,new AbortController().signal)).toEqual({stageDevice:'12',stageInode:'34'});expect(verify).toHaveBeenCalledOnce();expect(Buffer.from(c.send.mock.calls[0]![0]).toString()).toBe(JSON.stringify({...frame,kind:'stage-accepted'}));
});
it('fails closed on changed device or lost claim without acknowledging',async()=>{
 for(const lost of [false,true]){const c=channel(),verify=vi.fn(async()=>{if(lost)throw Error('lost');});await expect(acceptOexOwnerStage(c,Buffer.from(JSON.stringify(frame)),{...identity,stageDevice:lost?'12':'13'},verify,new AbortController().signal)).rejects.toThrow();expect(c.send).not.toHaveBeenCalled();expect(c.close).toHaveBeenCalledOnce();}
});
