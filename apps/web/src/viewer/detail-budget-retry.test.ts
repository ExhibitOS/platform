// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createDetailBudgetRetry} from './detail-budget-retry';

it('retries once after the existing scene reservation settles',()=>{
 let ready=false;const retry=vi.fn(),tick=createDetailBudgetRetry({valid:()=>true,ready:()=>ready,now:()=>1,deadline:10,retry});
 tick();expect(retry).not.toHaveBeenCalled();ready=true;tick();tick();expect(retry).toHaveBeenCalledOnce();
});
it('keeps the fallback on timeout or when the detail owner is no longer current',()=>{
 const retry=vi.fn();let now=0,valid=true,ready=false;const tick=createDetailBudgetRetry({valid:()=>valid,ready:()=>ready,now:()=>now,deadline:10,retry});
 tick();now=10;tick();ready=true;tick();expect(retry).not.toHaveBeenCalled();
 const cancelled=createDetailBudgetRetry({valid:()=>valid,ready:()=>ready,now:()=>0,deadline:10,retry});valid=false;cancelled();valid=true;cancelled();expect(retry).not.toHaveBeenCalled();
});
