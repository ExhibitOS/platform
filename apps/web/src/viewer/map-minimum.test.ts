// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {retainMapMinimum} from './map-minimum';
afterEach(()=>vi.useRealTimers());
function fixture(){const controller=new AbortController(),pins=new Map<string,number>(),waiters=new Set<()=>void>(),request=vi.fn();let ready=false,failed=false;return {controller,pins,waiters,request,ready(value:boolean){ready=value;},failed(value:boolean){failed=value;},options:{id:'art',signal:controller.signal,pins,waiters,request,ready:()=>ready,failed:()=>failed}};}
it('retains the current shared minimum until explicit release without another loader or reservation',async()=>{
 const f=fixture();f.ready(true);const release=await retainMapMinimum(f.options);expect(f.request).toHaveBeenCalledOnce();expect(f.pins.get('art')).toBe(1);expect(f.waiters.size).toBe(0);release();release();expect(f.pins.size).toBe(0);
});
it('counted pins survive overlapping same-art preparations and late release',async()=>{
 const f=fixture();f.ready(true);const first=await retainMapMinimum(f.options),second=await retainMapMinimum(f.options);expect(f.pins.get('art')).toBe(2);first();expect(f.pins.get('art')).toBe(1);first();expect(f.pins.get('art')).toBe(1);second();expect(f.pins.size).toBe(0);
});
it('cancellation releases the pin and waiter before any late scheduler result can succeed',async()=>{
 const f=fixture(),pending=retainMapMinimum(f.options);const result=expect(pending).rejects.toThrow('MAP_VISIT_CANCELLED');f.controller.abort();await result;expect(f.pins.size).toBe(0);expect(f.waiters.size).toBe(0);f.ready(true);for(const check of f.waiters)check();expect(f.request).toHaveBeenCalledOnce();
});
it('budget/failure refusal and the bounded timeout release all borrowed state without retrying',async()=>{
 const a=fixture();a.failed(true);await expect(retainMapMinimum(a.options)).rejects.toThrow('MAP_MINIMUM_UNAVAILABLE');expect(a.pins.size).toBe(0);expect(a.waiters.size).toBe(0);
 vi.useFakeTimers();const b=fixture(),pending=retainMapMinimum(b.options),result=expect(pending).rejects.toThrow('MAP_MINIMUM_TIMEOUT');await vi.advanceTimersByTimeAsync(10000);await result;expect(b.pins.size).toBe(0);expect(b.waiters.size).toBe(0);expect(b.request).toHaveBeenCalledOnce();
});
