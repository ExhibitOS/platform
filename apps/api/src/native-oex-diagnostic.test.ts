// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createNativeOexDiagnostic,traceNativeOexSelected} from './native-oex-diagnostic.ts';
it('reports only the first failure stage, allowlisted code and local channel observation',()=>{
 const d=createNativeOexDiagnostic();d.step('binding-verified');d.step('lease-start');d.fail({code:'55P03',message:'private secret /private/path'}, {isOpen:()=>true});d.step('completion-send-start');d.fail(Error('OEX_JOB_INVALID'),{isOpen:()=>false});
 expect(d.report()).toBe('NATIVE_OEX_DIAGNOSTIC lease-start 55P03 open');expect(d.report()).not.toContain('private');
});

it('emits only fixed post-save observations without dynamic data',()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const events=['postsave-scope-returned','postsave-check-start','postsave-check-returned','unlock-start','unlock-returned','unlock-failed','unlock-skipped','lifecycle-returned','upload-drain-start','upload-drain-returned','save-drain-start','save-drain-returned','final-live-start','final-live-returned','complete-send-start','complete-send-returned'] as const;
 try{for(const event of events)traceNativeOexSelected(event);expect(log.mock.calls).toEqual(events.map(event=>[`NATIVE_OEX_SELECTED ${event}`]));}finally{log.mockRestore();}
});
it('does not disclose unknown errors or exceptions while observing the channel',()=>{
 const d=createNativeOexDiagnostic();d.step('claim-ready-start');d.fail(Error('secret-token /private/path'),{isOpen(){throw Error('secret');}});
 expect(d.report()).toBe('NATIVE_OEX_DIAGNOSTIC claim-ready-start OTHER unknown');
});
it('classifies an allowlisted error without copying raw context',()=>{
 const d=createNativeOexDiagnostic();d.step('lease-returned');d.fail(Error('FILE_OPERATION_COMMIT_UNCERTAIN'),{});
 expect(d.report()).toBe('NATIVE_OEX_DIAGNOSTIC lease-returned FILE_OPERATION_COMMIT_UNCERTAIN unknown');
});
it('identifies the bounded preparation gap without exposing error context',()=>{
 const stages=['scene-validation-start','scene-validation-passed','inventory-live-start','inventory-transaction-start','inventory-transaction-returned','receiver-live-start','receiver-start','receiver-returned'] as const;
 for(const stage of stages){const d=createNativeOexDiagnostic();d.step(stage);d.fail({code:'OEX_INVENTORY_UNAVAILABLE',message:'secret /private/path'},{});expect(d.report()).toBe(`NATIVE_OEX_DIAGNOSTIC ${stage} OEX_INVENTORY_UNAVAILABLE unknown`);}
 const d=createNativeOexDiagnostic();d.step('scene-validation-start');d.fail(Error('OEX_TEST_SCENE_UNSUPPORTED'),{isOpen:()=>true});expect(d.report()).toBe('NATIVE_OEX_DIAGNOSTIC scene-validation-start OEX_TEST_SCENE_UNSUPPORTED open');
});
it('ignores arbitrary stage values and raw string errors',()=>{
 const d=createNativeOexDiagnostic();d.step('owner-selected');d.step('secret-token /private/path' as never);d.fail('secret-token /private/path',{});
 expect(d.report()).toBe('NATIVE_OEX_DIAGNOSTIC owner-selected OTHER unknown');
});

it('emits only fixed selected-flow labels and ignores untrusted values',()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{traceNativeOexSelected('put-received');traceNativeOexSelected('save-observed-frame-validated');traceNativeOexSelected('put-observer-resolved');traceNativeOexSelected('independent-reopen-matched');traceNativeOexSelected('save-verified-sent');traceNativeOexSelected('private /path token' as never);
  expect(log.mock.calls).toEqual([['NATIVE_OEX_SELECTED put-received'],['NATIVE_OEX_SELECTED save-observed-frame-validated'],['NATIVE_OEX_SELECTED put-observer-resolved'],['NATIVE_OEX_SELECTED independent-reopen-matched'],['NATIVE_OEX_SELECTED save-verified-sent']]);
 }finally{log.mockRestore();}
});
