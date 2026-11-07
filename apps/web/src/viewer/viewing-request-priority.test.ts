// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {AssetScheduler} from './loading';
import {viewingRequestPriority as priority} from './viewing-request-priority';

it.each(['already queued','newly queued'])('starts a %s viewing target before other queued work without cancellation',async mode=>{
 const started:string[]=[],aborted:string[]=[];let release!:()=>void;
 const scheduler=new AssetScheduler<string>({concurrency:1,load:async(key,signal)=>{started.push(key);signal.addEventListener('abort',()=>aborted.push(key));if(key==='active')await new Promise<void>(resolve=>{release=resolve;});return key;}});
 const active=scheduler.request('active',0);await new Promise(resolve=>setTimeout(resolve,0));
 const peer=scheduler.request('peer',priority(false,true,false,0));
 const target=mode==='already queued'?scheduler.request('target',priority(false,false,false,8)):undefined;
 const selected=scheduler.request('target',priority(true,false,false,8));if(target)expect(selected).toBe(target);
 release();await Promise.all([active,peer,selected]);expect(started).toEqual(['active','target','peer']);expect(aborted).toEqual([]);expect(scheduler.stats()).toMatchObject({completed:3,failed:0,cancelled:0});scheduler.dispose();
});

it('keeps the prior non-viewing priority order',()=>{expect(priority(false,true,false,9)).toBe(-100);expect(priority(false,false,true,9)).toBe(100);expect(priority(false,false,false,9)).toBe(9);});
