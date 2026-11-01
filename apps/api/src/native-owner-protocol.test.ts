// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {parseNativeOwnerOperation} from './native-owner-protocol.ts';
const id='11111111-1111-4111-8111-111111111111';
const claim={version:1,kind:'claim-open',correlationId:id,runtimeGeneration:id,workspaceId:id,tenantId:id,jobId:id};
const stage={...claim,kind:'stage-bound',attemptId:id,generation:id,stageId:id,reservationId:id,reservationGeneration:id,stageDevice:'0',stageInode:'42'};
const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
it('accepts only the exact ordered v1 Manager operation shapes',()=>{
 expect(parseNativeOwnerOperation(bytes(claim))).toEqual(claim);expect(parseNativeOwnerOperation(bytes(stage))).toEqual(stage);
 for(const value of [{...claim,extra:true},{...stage,stageInode:'042'},{...stage,attemptId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'},{...stage,kind:['stage-bound']},{kind:'claim-open',version:1,correlationId:id,runtimeGeneration:id,workspaceId:id,tenantId:id,jobId:id}])expect(()=>parseNativeOwnerOperation(bytes(value))).toThrow('NATIVE_OWNER_FRAME');
 const duplicate=JSON.stringify(claim).replace('"version":1','"version":1,"version":1');expect(()=>parseNativeOwnerOperation(Buffer.from(duplicate))).toThrow('NATIVE_OWNER_FRAME');
 expect(()=>parseNativeOwnerOperation(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes(claim)]))).toThrow('NATIVE_OWNER_FRAME');
 expect(()=>parseNativeOwnerOperation(Buffer.alloc(8193))).toThrow('NATIVE_OWNER_FRAME');
});
