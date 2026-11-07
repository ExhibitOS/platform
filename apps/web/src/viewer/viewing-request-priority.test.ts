// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {AssetScheduler} from './loading';

it.each(['already queued','newly queued'])('prioritizes a %s selected target without restarting any load',async mode=>{
 const started:string[]=[],aborted:string[]=[];let release!:()=>void;
 const scheduler=new AssetScheduler<string>({concurrency:1,load:async(key,signal)=>{started.push(key);signal.addEventListener('abort',()=>aborted.push(key));if(key==='active')await new Promise<void>(resolve=>{release=resolve;});return key;}});
 const active=scheduler.request('active');await new Promise(resolve=>setTimeout(resolve,0));
 const peer=scheduler.request('peer',-100),existing=mode==='already queued'?scheduler.request('target',8):undefined;
 const target=scheduler.request('target',8);if(existing)expect(target).toBe(existing);scheduler.setPriorityOverride('target',-200);
 release();await Promise.all([active,peer,target]);expect(started).toEqual(['active','target','peer']);expect(aborted).toEqual([]);expect(scheduler.stats()).toMatchObject({completed:3,failed:0,cancelled:0});scheduler.dispose();
});

it('restores a cancelled selection priority so the next selected target runs first',async()=>{
 const started:string[]=[],aborted:string[]=[];let release!:()=>void;
 const scheduler=new AssetScheduler<string>({concurrency:1,load:async(key,signal)=>{started.push(key);signal.addEventListener('abort',()=>aborted.push(key));if(key==='active')await new Promise<void>(resolve=>{release=resolve;});return key;}});
 const active=scheduler.request('active');await new Promise(resolve=>setTimeout(resolve,0));const a=scheduler.request('a',1);scheduler.setPriorityOverride('a',-200);scheduler.setPriorityOverride('a');const b=scheduler.request('b',2);scheduler.setPriorityOverride('b',-200);
 release();await Promise.all([active,a,b]);expect(started).toEqual(['active','b','a']);expect(aborted).toEqual([]);scheduler.dispose();
});
