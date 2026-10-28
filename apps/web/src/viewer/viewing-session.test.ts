// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import {createViewingSession,type PreparedViewingStop,type ViewingState} from './viewing-session';
const stops=[{placementId:'a',viewpointId:'va'},{placementId:'b',viewpointId:'vb'},{placementId:'c',viewpointId:'vc'}];
function fixture(){
 const changed=vi.fn<(state:ViewingState)=>void>(),free=vi.fn(()=>true);
 const work:{id:string;signal:AbortSignal;resolve:(value:PreparedViewingStop)=>void;reject:(e:Error)=>void}[]=[];
 const session=createViewingSession({stops,free,changed,prepare:(stop,signal)=>new Promise((resolve,reject)=>work.push({id:stop.placementId,signal,resolve,reject}))});
 return {session,work,free,changed};
}
const prepared=()=>({commit:vi.fn(()=>true),release:vi.fn()});
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
test('no automatic visit; pending target never replaces committed current until ready and safe',async()=>{
 const f=fixture();expect(f.work).toHaveLength(0);f.session.actions.setStyle('ordered');expect(f.session.state().currentPlacementId).toBeUndefined();
 const a=prepared();f.work[0]!.resolve(a);await flush();expect(f.session.state()).toMatchObject({style:'ordered',currentPlacementId:'a',status:'idle'});expect(a.release).toHaveBeenCalledOnce();
 f.session.actions.step(1);expect(f.session.state()).toMatchObject({currentPlacementId:'a',pendingPlacementId:'b',status:'preparing'});
 f.work[1]!.reject(Error('budget'));await flush();expect(f.session.state()).toMatchObject({currentPlacementId:'a',status:'blocked'});expect(f.work).toHaveLength(2);
});
test('a late cancelled preparation cannot commit or erase a newer intent',async()=>{
 const f=fixture();f.session.actions.setStyle('ordered');f.session.actions.select('b');expect(f.work[0]!.signal.aborted).toBe(true);
 const old=prepared(),next=prepared();f.work[1]!.resolve(next);await flush();f.work[0]!.resolve(old);await flush();
 expect(old.commit).not.toHaveBeenCalled();expect(old.release).toHaveBeenCalledOnce();expect(f.session.state().currentPlacementId).toBe('b');
});
test('free/cancel/dispose abort pending work and release late results without camera commit',async()=>{
 for(const action of ['free','cancel','dispose'] as const){const f=fixture();f.session.actions.setStyle('ordered');
  if(action==='free')f.session.actions.setStyle('free');else if(action==='cancel')f.session.actions.cancel();else f.session.dispose();
  expect(f.work[0]!.signal.aborted).toBe(true);const late=prepared();f.work[0]!.resolve(late);await flush();expect(late.commit).not.toHaveBeenCalled();expect(late.release).toHaveBeenCalledOnce();
 }
});
test('failed safe commit keeps current and frees preparation; list bounds never wrap or autoplay',async()=>{
 const f=fixture();f.session.actions.setStyle('ordered');f.work[0]!.resolve(prepared());await flush();f.session.actions.step(-1);expect(f.work).toHaveLength(1);
 f.session.actions.step(1);const denied=prepared();denied.commit.mockReturnValue(false);f.work[1]!.resolve(denied);await flush();expect(denied.release).toHaveBeenCalledOnce();expect(f.session.state()).toMatchObject({style:'ordered',currentPlacementId:'a',status:'blocked'});
});
