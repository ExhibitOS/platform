// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createDetailBudgetRetry,detailBudgetRetryReady} from './detail-budget-retry';

it('retries once after the existing scene reservation settles',()=>{
 let ready=false;const retry=vi.fn(),tick=createDetailBudgetRetry({valid:()=>true,ready:()=>ready,now:()=>1,deadline:10,retry});
 tick();expect(retry).not.toHaveBeenCalled();ready=true;tick();tick();expect(retry).toHaveBeenCalledOnce();
});
it('waits for material settlement and its deferred fallback replay before admitting the original',()=>{
 const state={floorSettled:false,surfaceSettled:true,deferred:1,active:0,queued:0,pending:false,candidate:false,used:100,sceneCap:200,reservation:400,transitionCap:700};
 const retry=vi.fn(),tick=createDetailBudgetRetry({valid:()=>true,ready:()=>detailBudgetRetryReady(state),now:()=>1,deadline:10,retry});
 tick();state.floorSettled=true;tick();expect(retry).not.toHaveBeenCalled();
 state.deferred=0;state.active=1;tick();expect(retry).not.toHaveBeenCalled();
 state.active=0;state.pending=true;tick();expect(retry).not.toHaveBeenCalled();
 state.pending=false;state.candidate=true;tick();expect(retry).not.toHaveBeenCalled();
 state.candidate=false;tick();expect(retry).toHaveBeenCalledOnce();
});
it('keeps the fallback on timeout or when the detail owner is no longer current',()=>{
 const retry=vi.fn();let now=0,valid=true,ready=false;const tick=createDetailBudgetRetry({valid:()=>valid,ready:()=>ready,now:()=>now,deadline:10,retry});
 tick();now=10;tick();ready=true;tick();expect(retry).not.toHaveBeenCalled();
 const cancelled=createDetailBudgetRetry({valid:()=>valid,ready:()=>ready,now:()=>0,deadline:10,retry});valid=false;cancelled();valid=true;cancelled();expect(retry).not.toHaveBeenCalled();
});
