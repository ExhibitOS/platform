// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {parseNativeOexSaveObserved} from './native-oex-save-observed.ts';
it('correlates canonical v3 save observation and rejects cross-operation frames',()=>{
 const ready={version:1,kind:'save-ready-v3',correlationId:'correlation',operationCorrelationId:'operation',attemptId:'attempt',runtimeGeneration:'runtime',stageId:'stage',reportSha256:'report',exhibitionId:'exhibition',etag:'before',requestId:'request'};
 const observed={...ready,kind:'save-observed-v3',etag:'after'},bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
 expect(parseNativeOexSaveObserved(bytes(observed),ready,'v3')).toBe('after');
 for(const bad of [{...observed,attemptId:'different'},{...observed,reportSha256:'different'},{...observed,requestId:'different'},{...observed,kind:'save-observed'},{...observed,extra:true}])expect(()=>parseNativeOexSaveObserved(bytes(bad),ready,'v3')).toThrow('NATIVE_OEX_OWNER');
 expect(()=>parseNativeOexSaveObserved(bytes(observed),ready)).toThrow('NATIVE_OEX_OWNER');
});
it('preserves v2 save observation and rejects v3 or noncanonical encoding',()=>{
 const ready={version:1,kind:'save-ready',correlationId:'correlation',attemptId:'attempt',exhibitionId:'exhibition',etag:'before',requestId:'request'},observed={...ready,kind:'save-observed',etag:'after'};
 expect(parseNativeOexSaveObserved(Buffer.from(JSON.stringify(observed)),ready)).toBe('after');expect(()=>parseNativeOexSaveObserved(Buffer.from(JSON.stringify(observed,null,2)),ready)).toThrow('NATIVE_OEX_OWNER');expect(()=>parseNativeOexSaveObserved(Buffer.from(JSON.stringify(observed)),ready,'v3')).toThrow('NATIVE_OEX_OWNER');
});
