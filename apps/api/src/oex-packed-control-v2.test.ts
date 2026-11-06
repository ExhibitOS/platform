// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {parsePackedOexControlV2} from './oex-packed-control-v2.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const h='a'.repeat(64),correlationId=id(1);
const control={version:2,kind:'oex-packed-v2',tenantId:id(2),resourceId:id(3),jobId:id(4),userId:id(5),requestId:id(6),leaseId:id(7),attemptId:id(8),runtimeGeneration:id(9),stageId:id(10),reservationId:id(11),reservationGeneration:id(12),archiveBytes:67108865,archiveSha256:h,capacity:536870912,inputDevice:'1',inputInode:'2',outputDevice:'1',outputInode:'3',reservationDigest:h,sourceDigest:h,workerDigest:h,profile:'bounded-file-v1',format:'1.0.0-draft.9'};
const {version:_v,kind:_k,outputInode:_o,profile:_p,format:_f,...base}=control,expected={...base,correlationId};
void _v;void _k;void _o;void _p;void _f;
const frame=(c:unknown)=>Buffer.from(JSON.stringify({version:1,kind:'worker-control',correlationId,attemptId:control.attemptId,control:c}));
it('binds exact control bytes to independently supplied claim fields',()=>{
 const result=parsePackedOexControlV2(frame(control),expected);expect(result).toEqual({controlSha256:createHash('sha256').update(JSON.stringify(control)).digest('hex'),outputDevice:'1',outputInode:'3'});
 expect(()=>parsePackedOexControlV2(frame({...control,capacity:1}),expected)).toThrow('OEX_PACKED_CONTROL');
 expect(()=>parsePackedOexControlV2(frame({...control,outputInode:'2'}),expected)).toThrow('OEX_PACKED_CONTROL');
 expect(()=>parsePackedOexControlV2(frame({...control,extra:true}),expected)).toThrow('OEX_PACKED_CONTROL');
});
it('keeps the v3 owner wrapper distinct while using the same child control',()=>{
 const raw=Buffer.from(JSON.stringify({version:1,kind:'worker-control-v3',correlationId,attemptId:control.attemptId,control}));
 expect(parsePackedOexControlV2(raw,expected,'v3').outputInode).toBe('3');
 expect(()=>parsePackedOexControlV2(raw,expected)).toThrow('OEX_PACKED_CONTROL');
 expect(()=>parsePackedOexControlV2(frame(control),expected,'v3')).toThrow('OEX_PACKED_CONTROL');
});

it('binds draft10 only to an independently selected draft10 claim and keeps legacy default9',()=>{
 const ten={...control,format:'1.0.0-draft.10'};
 expect(parsePackedOexControlV2(frame(ten),{...expected,archiveFormat:'1.0.0-draft.10'}).outputInode).toBe('3');
 expect(()=>parsePackedOexControlV2(frame(ten),expected)).toThrow('OEX_PACKED_CONTROL');
 expect(()=>parsePackedOexControlV2(frame(control),{...expected,archiveFormat:'1.0.0-draft.10'})).toThrow('OEX_PACKED_CONTROL');
 expect(()=>parsePackedOexControlV2(frame({...ten,format:'1.0.0-draft.11'}),{...expected,archiveFormat:'1.0.0-draft.10'})).toThrow('OEX_PACKED_CONTROL');
});
it('accepts draft12 only for the explicitly selected v3 workspace path',()=>{
 const twelve={...control,format:'1.0.0-draft.12'},raw=Buffer.from(JSON.stringify({version:1,kind:'worker-control-v3',correlationId,attemptId:control.attemptId,control:twelve})),selected={...expected,archiveFormat:'1.0.0-draft.12' as const};
 expect(parsePackedOexControlV2(raw,selected,'v3',true).outputInode).toBe('3');expect(()=>parsePackedOexControlV2(raw,selected,'v3')).toThrow('OEX_PACKED_CONTROL');expect(()=>parsePackedOexControlV2(frame(twelve),selected,undefined,true)).toThrow('OEX_PACKED_CONTROL');expect(()=>parsePackedOexControlV2(raw,{...expected,archiveFormat:'1.0.0-draft.10'},'v3',true)).toThrow('OEX_PACKED_CONTROL');
});
