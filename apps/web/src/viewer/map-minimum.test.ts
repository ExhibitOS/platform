// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {retainMapMinimum} from './map-minimum';
import {AssetScheduler} from './loading';
afterEach(()=>vi.useRealTimers());
function fixture(){const controller=new AbortController(),pins=new Map<string,number>(),waiters=new Set<()=>void>(),request=vi.fn();let ready=false,failed=false;return {controller,pins,waiters,request,ready(value:boolean){ready=value;},failed(value:boolean){failed=value;},options:{id:'art',signal:controller.signal,pins,waiters,request,onLastRelease:vi.fn(),ready:()=>ready,failed:()=>failed}};}
it('retains the current shared minimum until explicit release without another loader or reservation',async()=>{
 const f=fixture();f.ready(true);const release=await retainMapMinimum(f.options);expect(f.request).toHaveBeenCalledOnce();expect(f.pins.get('art')).toBe(1);expect(f.waiters.size).toBe(0);release();release();expect(f.pins.size).toBe(0);
});
it('counted pins survive overlapping same-art preparations and late release',async()=>{
 const f=fixture();f.ready(true);const first=await retainMapMinimum(f.options),second=await retainMapMinimum(f.options);expect(f.pins.get('art')).toBe(2);first();expect(f.pins.get('art')).toBe(1);expect(f.options.onLastRelease).not.toHaveBeenCalled();first();expect(f.pins.get('art')).toBe(1);second();expect(f.pins.size).toBe(0);expect(f.options.onLastRelease).toHaveBeenCalledOnce();
});
it('cancellation releases the pin and waiter before any late scheduler result can succeed',async()=>{
 const f=fixture(),pending=retainMapMinimum(f.options);const result=expect(pending).rejects.toThrow('MAP_VISIT_CANCELLED');f.controller.abort();await result;expect(f.pins.size).toBe(0);expect(f.waiters.size).toBe(0);f.ready(true);for(const check of f.waiters)check();expect(f.request).toHaveBeenCalledOnce();
});
it('budget/failure refusal and the bounded timeout release all borrowed state without retrying',async()=>{
 const a=fixture();a.failed(true);await expect(retainMapMinimum(a.options)).rejects.toThrow('MAP_MINIMUM_UNAVAILABLE');expect(a.pins.size).toBe(0);expect(a.waiters.size).toBe(0);
 vi.useFakeTimers();const b=fixture(),pending=retainMapMinimum(b.options),result=expect(pending).rejects.toThrow('MAP_MINIMUM_TIMEOUT');await vi.advanceTimersByTimeAsync(10000);await result;expect(b.pins.size).toBe(0);expect(b.waiters.size).toBe(0);expect(b.request).toHaveBeenCalledOnce();expect(b.options.onLastRelease).toHaveBeenCalledOnce();
});

it.each(['new','queued','cancelled','overlapping viewing'])('uses the existing serial scheduler for a %s map minimum',async mode=>{
 const f=fixture(),started:string[]=[];
 let releaseActive!:()=>void;
 const scheduler=new AssetScheduler<string>({concurrency:1,load:async key=>{
  started.push(key);
  if(key==='active')await new Promise<void>(resolve=>{releaseActive=resolve;});
  return key;
 }});
 const active=scheduler.request('active');
 await Promise.resolve();
 const peer=scheduler.request('peer',-100);
 const queued=mode==='queued'?scheduler.request('target',8):undefined;
 let target!:Promise<string>;
 const selection=retainMapMinimum({...f.options,request:()=>{
  target=scheduler.request('target',8);
  if(queued)expect(target).toBe(queued);
  scheduler.setPriorityOverride('target',-200);
  void target.then(()=>{f.ready(true);for(const check of f.waiters)check();});
 },onLastRelease:()=>scheduler.setPriorityOverride('target',mode==='overlapping viewing'?-200:undefined)});
 if(mode==='cancelled'||mode==='overlapping viewing'){
  const cancelled=expect(selection).rejects.toThrow('MAP_VISIT_CANCELLED');
  f.controller.abort();
  await cancelled;
 }
 releaseActive();
 if(mode==='new'||mode==='queued')(await selection)();
 await Promise.all([active,peer,target]);
 expect(started).toEqual(mode==='cancelled'?['active','peer','target']:['active','target','peer']);
 expect(scheduler.stats()).toMatchObject({completed:3,cancelled:0,failed:0});
 scheduler.dispose();
});
