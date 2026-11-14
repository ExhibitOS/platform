// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {BENCH_NAMESPACE,PRESENTATION_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {createMapTravel,mapStandingDestinations,mapTargetDestinations,type MapTravelState,type MapVisit} from './map-travel';
import type {VisitorMap} from './visitor-map';
const map:VisitorMap={key:'published/a',rooms:[{id:'Room',name:'Room',outline:[]}],doors:[],placements:[{id:'Painting',roomId:'Room',title:'Painting',artworkType:'image',point:[0,0]}],bounds:{x:0,z:0,width:1,depth:1}};
const stops=[{placementId:'Painting',viewpointId:'View'}];
const destinations=[{id:'View',roomId:'Room',name:'Authored position'}];
it('passes only existing same-room authored identities to the camera owner after explicit activation',async()=>{
 const visit=vi.fn<(request:MapVisit,signal:AbortSignal)=>Promise<boolean>>(async()=>true),changed=vi.fn<(s:MapTravelState)=>void>(),travel=createMapTravel(map,destinations,()=>({visit}),changed,stops);
 expect(visit).not.toHaveBeenCalled();expect(await travel.go({kind:'placement',id:'painting'},'VIEW')).toBe(true);
 expect(visit.mock.calls[0]![0]).toEqual({roomId:'Room',viewpointId:'View',placementId:'Painting'});expect(changed.mock.calls[0]![0].status).toBe('preparing');expect(changed.mock.lastCall![0].status).toBe('idle');
});
it('rejects unknown targets, dangling viewpoints and cross-room requests without invoking the renderer',async()=>{
 const visit=vi.fn(async()=>true),changed=vi.fn(),travel=createMapTravel(map,[...destinations,{id:'Other',roomId:'elsewhere',name:'Other'}],()=>({visit}),changed,stops);
 for(const [id,view]of [['missing','View'],['Painting','missing'],['Painting','Other']])expect(await travel.go({kind:'placement',id:id!},view!)).toBe(false);
 expect(visit).not.toHaveBeenCalled();expect(changed.mock.lastCall![0].status).toBe('blocked');
});
it('cancel, replacement and disposal abort pending work; late results cannot replace a newer status',async()=>{
 const work:{signal:AbortSignal;resolve:(value:boolean)=>void}[]=[],changed=vi.fn<(s:MapTravelState)=>void>();
 const visit=(_request:MapVisit,signal:AbortSignal)=>new Promise<boolean>(resolve=>work.push({signal,resolve}));
 const travel=createMapTravel(map,destinations,()=>({visit}),changed,stops),first=travel.go({kind:'room',id:'Room'},'View');
 const second=travel.go({kind:'placement',id:'Painting'},'View');expect(work[0]!.signal.aborted).toBe(true);work[0]!.resolve(true);expect(await first).toBe(false);
 travel.cancel();expect(work[1]!.signal.aborted).toBe(true);const last=changed.mock.lastCall![0];work[1]!.resolve(true);expect(await second).toBe(false);expect(changed.mock.lastCall![0]).toEqual(last);
 const third=travel.go({kind:'room',id:'Room'},'View');travel.dispose();expect(work[2]!.signal.aborted).toBe(true);const count=changed.mock.calls.length;work[2]!.resolve(true);expect(await third).toBe(false);expect(changed.mock.calls).toHaveLength(count);
});
it('reports a blocked visit when existing readiness or clearance refuses, without retrying or fabricating a destination',async()=>{
 const changed=vi.fn(),visit=vi.fn(async()=>false),travel=createMapTravel(map,destinations,()=>({visit}),changed,stops);
 expect(await travel.go({kind:'room',id:'Room'},'View')).toBe(false);expect(visit).toHaveBeenCalledOnce();expect(changed.mock.lastCall![0].status).toBe('blocked');
});

it('offers standing views while keeping bench viewpoints out of walking requests',async()=>{
 const exhibition=newDraft().candidate;
 const roomId=exhibition.rooms[0]!.id;
 const seated={id:crypto.randomUUID(),roomId,name:'Bench seat',position:[0,1.2,2],target:[0,1.2,0],fov:50};
 const standing={...seated,id:crypto.randomUUID(),name:'Standing view',position:[1.5,1.65,2]};
 const bench={id:crypto.randomUUID(),name:'Bench',roomId,viewpointId:seated.id.toUpperCase(),kind:'slab',position:[0,0,2],yaw:0,dimensions:{width:1.5,height:.45,depth:.6},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0}};
 exhibition.extensions={...exhibition.extensions,[BENCH_NAMESPACE]:{version:1,benches:[bench]},[PRESENTATION_NAMESPACE]:{version:1,credits:'',viewpoints:[seated]}};
 expect(mapStandingDestinations(exhibition)).toEqual([]);
 exhibition.extensions[PRESENTATION_NAMESPACE]={version:1,credits:'',viewpoints:[seated,standing]};
 const choices=mapStandingDestinations(exhibition);
 expect(choices).toEqual([{id:standing.id,roomId,name:standing.name}]);
 const visit=vi.fn(async()=>true);
 const travel=createMapTravel({...map,rooms:[{...map.rooms[0]!,id:roomId}]},choices,()=>({visit}),vi.fn());
 expect(await travel.go({kind:'room',id:roomId},seated.id)).toBe(false);
 expect(visit).not.toHaveBeenCalled();
 expect(await travel.go({kind:'room',id:roomId},standing.id)).toBe(true);
 expect(visit).toHaveBeenCalledOnce();
});

it('offers an artwork only its authored same-room stop while retaining room choices',()=>{
 const choices=[...destinations,{id:'OtherView',roomId:'Room',name:'Other artwork'},{id:'Elsewhere',roomId:'elsewhere',name:'Other room'}];
 expect(mapTargetDestinations(map,{kind:'placement',id:'painting'},choices,[])).toEqual([]);
 expect(mapTargetDestinations(map,{kind:'placement',id:'Painting'},choices,[{placementId:'Painting',viewpointId:'Elsewhere'}])).toEqual([]);
 expect(mapTargetDestinations(map,{kind:'placement',id:'PAINTING'},choices,stops)).toEqual(destinations);
 expect(mapTargetDestinations(map,{kind:'room',id:'room'},choices,[])).toEqual(choices.slice(0,2));
 expect(mapTargetDestinations(map,undefined,choices,stops)).toEqual([]);
});
it('rejects an unrelated room view for an artwork before preparation without changing selection or requesting a pose',async()=>{
 const visit=vi.fn(async()=>true),changed=vi.fn(),target={kind:'placement' as const,id:'Painting'},before=structuredClone(map);
 const travel=createMapTravel(map,destinations,()=>({visit}),changed);
 expect(await travel.go(target,'View')).toBe(false);expect(visit).not.toHaveBeenCalled();expect(map).toEqual(before);
 const valid=createMapTravel(map,destinations,()=>({visit}),changed,stops);
 expect(await valid.go(target,'View')).toBe(true);expect(visit).toHaveBeenCalledOnce();
});
