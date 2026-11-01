// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {parsePackedOexControlV2} from './oex-packed-control-v2.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const h='a'.repeat(64),correlationId=id(1);
const control={version:2,kind:'oex-packed-v2',tenantId:id(2),resourceId:id(3),jobId:id(4),userId:id(5),requestId:id(6),leaseId:id(7),attemptId:id(8),runtimeGeneration:id(9),stageId:id(10),reservationId:id(11),reservationGeneration:id(12),archiveBytes:67108865,archiveSha256:h,capacity:536870912,inputDevice:'1',inputInode:'2',outputDevice:'1',outputInode:'3',reservationDigest:h,sourceDigest:h,workerDigest:h,profile:'bounded-file-v1',format:'1.0.0-draft.9'};
const {version:_v,kind:_k,outputInode:_o,profile:_p,format:_f,...base}=control,expected={...base,correlationId};
const frame=(c:unknown)=>Buffer.from(JSON.stringify({version:1,kind:'worker-control',correlationId,attemptId:control.attemptId,control:c}));
it('binds exact control bytes to independently supplied claim fields',()=>{
 const result=parsePackedOexControlV2(frame(control),expected);expect(result).toEqual({controlSha256:createHash('sha256').update(JSON.stringify(control)).digest('hex'),outputDevice:'1',outputInode:'3'});
 expect(()=>parsePackedOexControlV2(frame({...control,capacity:1}),expected)).toThrow('OEX_PACKED_CONTROL');
 expect(()=>parsePackedOexControlV2(frame({...control,outputInode:'2'}),expected)).toThrow('OEX_PACKED_CONTROL');
 expect(()=>parsePackedOexControlV2(frame({...control,extra:true}),expected)).toThrow('OEX_PACKED_CONTROL');
});
