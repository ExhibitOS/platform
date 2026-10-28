// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {newDraft} from '../drafts/example';
import {syntheticArtwork,newPlacement} from '../placement/model';
import {buildVisitorMap,selectVisitorMap,visitorMapPose,visitorMapPreview,type MapSelection,type MapTarget} from './visitor-map';

const source={id:'70000000-0000-4000-8000-000000000001',revisionSha256:'a'.repeat(64)};
const identity=()=>({position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]});
function fixture(){
 const doc=newDraft().candidate,room=doc.rooms[0]!;doc.artworks=[];doc.placements=[];doc.surfaces=[];doc.openings=[];
 const art=syntheticArtwork('image'),p=newPlacement(art,room.id);doc.artworks=[art];doc.placements=[p];
 return {doc,room,art,p};
}
it('projects noncommuting room, placement and artifact transforms once, without modifying authored coordinates',()=>{
 const {doc,room,art,p}=fixture();room.dimensions={width:4,height:3,depth:6};room.transform={position:[10,0,20],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[2,1,3]};
 art.transform={...identity(),position:[1,0,0]};p.transform={...identity(),position:[1,1,0],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2]};
 const before=structuredClone(doc),map=buildVisitorMap(doc,source),outline=map.rooms[0]!.outline;
 for(const [i,golden]of [[1,24],[1,16],[19,16],[19,24]].entries()){expect(outline[i]![0]).toBeCloseTo(golden[0]!);expect(outline[i]![1]).toBeCloseTo(golden[1]!);}
 expect(map.placements[0]!.point[0]).toBeCloseTo(7);expect(map.placements[0]!.point[1]).toBeCloseTo(18);expect(doc).toEqual(before);
 expect(map.placements[0]).toMatchObject({id:p.id,title:art.metadata.title,artworkType:'image'});
});
it('projects door offsets in their wall and room frame and exposes only explicit reciprocal door relationships',()=>{
 const {doc,room}=fixture();room.transform={position:[10,0,20],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[2,1,3]};
 const second={...structuredClone(room),id:crypto.randomUUID()},wall={id:crypto.randomUUID(),roomId:room.id,type:'wall' as const,dimensions:{width:4,height:4},transform:{...identity(),position:[0,2,-3] as [number,number,number]}};
 const otherWall={...structuredClone(wall),id:crypto.randomUUID(),roomId:second.id};doc.rooms.push(second);doc.surfaces=[wall,otherWall];
 const a={id:crypto.randomUUID(),surfaceId:wall.id,type:'door' as const,offset:[.5,-1] as [number,number],dimensions:{width:2,height:2},connectsToOpeningId:crypto.randomUUID()};
 const b={...structuredClone(a),id:a.connectsToOpeningId,surfaceId:otherWall.id,connectsToOpeningId:a.id};doc.openings=[a,b,{...structuredClone(a),id:crypto.randomUUID(),type:'window'}];
 const map=buildVisitorMap(doc,source);expect(map.doors).toHaveLength(2);expect(map.doors[0]!.connection).toEqual({doorId:b.id,roomId:second.id});
 for(const [i,golden]of [[1,21],[1,17]].entries()){expect(map.doors[0]!.edge[i]![0]).toBeCloseTo(golden[0]!);expect(map.doors[0]!.edge[i]![1]).toBeCloseTo(golden[1]!);}
 delete (b as {connectsToOpeningId?:string}).connectsToOpeningId;expect(buildVisitorMap(doc,source).doors[0]!.connection).toBeUndefined();
});
it('keeps an empty schematic finite and refuses missing references, nonfinite transforms and the existing display envelope overflow',()=>{
 const {doc}=fixture();const empty={...doc,rooms:[],artworks:[],placements:[],surfaces:[],openings:[]} as Exhibition;
 const map=buildVisitorMap(empty,source);expect(map.bounds).toEqual({x:-1.5,z:-1.5,width:3,depth:3});expect(map.placements).toEqual([]);
 const broken=structuredClone(doc);broken.artworks=[];expect(()=>buildVisitorMap(broken,source)).toThrow('VISITOR_MAP_UNSUPPORTED');
 const bad=structuredClone(doc);bad.rooms[0]!.transform.position[0]=Infinity;expect(()=>buildVisitorMap(bad,source)).toThrow();
 const large=structuredClone(doc);large.rooms=Array(33).fill(doc.rooms[0]!);expect(()=>buildVisitorMap(large,source)).toThrow('VISITOR_MAP_UNSUPPORTED');
});
it('keeps keyboard focus, hover preview and explicit activation distinct, including late leave/blur events',()=>{
 const {doc,room,p}=fixture(),map=buildVisitorMap(doc,source),a:MapTarget={kind:'room',id:room.id},b:MapTarget={kind:'placement',id:p.id};
 let state:MapSelection={key:map.key};const original=structuredClone(state);
 state=selectVisitorMap(map,state,{key:map.key,type:'hover',target:a});expect(state.selected).toBeUndefined();expect(visitorMapPreview(map,state)).toEqual(a);expect(original).toEqual({key:map.key});
 state=selectVisitorMap(map,state,{key:map.key,type:'focus',target:b});expect(visitorMapPreview(map,state)).toEqual(b);
 state=selectVisitorMap(map,state,{key:map.key,type:'hover',target:b});state=selectVisitorMap(map,state,{key:map.key,type:'leave',target:a});expect(state.hovered).toEqual(b);
 state=selectVisitorMap(map,state,{key:map.key,type:'select',target:{...b,id:b.id.toUpperCase()}});expect(state.selected).toEqual(b);
 state=selectVisitorMap(map,state,{key:map.key,type:'blur',target:b});state=selectVisitorMap(map,state,{key:map.key,type:'leave',target:b});expect(visitorMapPreview(map,state)).toEqual(b);
 expect(selectVisitorMap(map,state,{key:map.key,type:'dismiss'})).toEqual({key:map.key});
});
it('rejects stale publication interactions and unknown marker identities rather than creating destinations',()=>{
 const {doc,p}=fixture(),map=buildVisitorMap(doc,source),target:MapTarget={kind:'placement',id:p.id};
 const state=selectVisitorMap(map,{key:map.key},{key:map.key,type:'select',target});
 expect(selectVisitorMap(map,state,{key:map.key,type:'select',target:{...target,id:crypto.randomUUID()}})).toEqual(state);
 const next=buildVisitorMap(doc,{...source,revisionSha256:'b'.repeat(64)});expect(visitorMapPreview(next,state)).toBeUndefined();
 expect(selectVisitorMap(next,state,{key:map.key,type:'select',target})).toEqual({key:next.key});
});
it('projects the existing world pose and yaw without a camera or frame loop',()=>{
 const pose=visitorMapPose([12,1.65,-7],Math.PI/2)!;expect(pose.point).toEqual([12,-7]);expect(pose.direction[0]).toBeCloseTo(-1);expect(pose.direction[1]).toBeCloseTo(0);
 expect(visitorMapPose([NaN,0,0],0)).toBeUndefined();expect(visitorMapPose([0,0,0],Infinity)).toBeUndefined();
});
