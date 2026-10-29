// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createMapTravel,type MapTravelState,type MapVisit} from './map-travel';
import type {VisitorMap} from './visitor-map';
const map:VisitorMap={key:'published/a',rooms:[{id:'Room',name:'Room',outline:[]}],doors:[],placements:[{id:'Painting',roomId:'Room',title:'Painting',artworkType:'image',point:[0,0]}],bounds:{x:0,z:0,width:1,depth:1}};
const destinations=[{id:'View',roomId:'Room',name:'Authored position'}];
it('passes only existing same-room authored identities to the camera owner after explicit activation',async()=>{
 const visit=vi.fn<(request:MapVisit,signal:AbortSignal)=>Promise<boolean>>(async()=>true),changed=vi.fn<(s:MapTravelState)=>void>(),travel=createMapTravel(map,destinations,()=>({visit}),changed);
 expect(visit).not.toHaveBeenCalled();expect(await travel.go({kind:'placement',id:'painting'},'VIEW')).toBe(true);
 expect(visit.mock.calls[0]![0]).toEqual({roomId:'Room',viewpointId:'View',placementId:'Painting'});expect(changed.mock.calls[0]![0].status).toBe('preparing');expect(changed.mock.lastCall![0].status).toBe('idle');
});
it('rejects unknown targets, dangling viewpoints and cross-room requests without invoking the renderer',async()=>{
 const visit=vi.fn(async()=>true),changed=vi.fn(),travel=createMapTravel(map,[...destinations,{id:'Other',roomId:'elsewhere',name:'Other'}],()=>({visit}),changed);
 for(const [id,view]of [['missing','View'],['Painting','missing'],['Painting','Other']])expect(await travel.go({kind:'placement',id:id!},view!)).toBe(false);
 expect(visit).not.toHaveBeenCalled();expect(changed.mock.lastCall![0].status).toBe('blocked');
});
it('cancel, replacement and disposal abort pending work; late results cannot replace a newer status',async()=>{
 const work:{signal:AbortSignal;resolve:(value:boolean)=>void}[]=[],changed=vi.fn<(s:MapTravelState)=>void>();
 const visit=(_request:MapVisit,signal:AbortSignal)=>new Promise<boolean>(resolve=>work.push({signal,resolve}));
 const travel=createMapTravel(map,destinations,()=>({visit}),changed),first=travel.go({kind:'room',id:'Room'},'View');
 const second=travel.go({kind:'placement',id:'Painting'},'View');expect(work[0]!.signal.aborted).toBe(true);work[0]!.resolve(true);expect(await first).toBe(false);
 travel.cancel();expect(work[1]!.signal.aborted).toBe(true);const last=changed.mock.lastCall![0];work[1]!.resolve(true);expect(await second).toBe(false);expect(changed.mock.lastCall![0]).toEqual(last);
 const third=travel.go({kind:'room',id:'Room'},'View');travel.dispose();expect(work[2]!.signal.aborted).toBe(true);const count=changed.mock.calls.length;work[2]!.resolve(true);expect(await third).toBe(false);expect(changed.mock.calls).toHaveLength(count);
});
it('reports a blocked visit when existing readiness or clearance refuses, without retrying or fabricating a destination',async()=>{
 const changed=vi.fn(),visit=vi.fn(async()=>false),travel=createMapTravel(map,destinations,()=>({visit}),changed);
 expect(await travel.go({kind:'room',id:'Room'},'View')).toBe(false);expect(visit).toHaveBeenCalledOnce();expect(changed.mock.lastCall![0].status).toBe('blocked');
});
