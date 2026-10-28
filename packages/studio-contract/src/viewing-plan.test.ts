// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {VIEWING_PLAN_NAMESPACE as N,viewingPlanFor,validateViewingPlan,remapViewingPlan} from './viewing-plan';
import {PRESENTATION_NAMESPACE as P} from './index';
const room=crypto.randomUUID(),placement=crypto.randomUUID(),view=crypto.randomUUID(),revision=crypto.randomUUID();
function fixture(){return {rooms:[{id:room,dimensions:{width:10,height:3,depth:10}}],placements:[{id:placement,roomId:room,artworkRevisionId:revision}],artworks:[{revisionId:revision,artworkType:'sculpture'}],extensions:{[P]:{version:1,viewpoints:[{id:view,name:'Authored view',roomId:room,position:[1,1.65,2],target:[0,1,-1],fov:50}],credits:'Keep me'},[N]:{version:1,stops:[{placementId:placement,viewpointId:view,orbit:{minYaw:-Math.PI,maxYaw:Math.PI}}]}}};}
test('absent/empty plan preserves legacy and fresh defaults without source mutation',()=>{
 expect(validateViewingPlan({}).valid).toBe(true);const a=viewingPlanFor({});a.stops.push({placementId:placement,viewpointId:view});expect(viewingPlanFor({}).stops).toEqual([]);
 const doc=fixture(),before=structuredClone(doc);expect(validateViewingPlan(doc).valid).toBe(true);viewingPlanFor(doc).stops.reverse();expect(doc).toEqual(before);doc.extensions[N].stops=[];expect(validateViewingPlan(doc).valid).toBe(true);
});
test('reference identities, unique placements and bounded closed profiles fail safely',()=>{
 for(const change of [(d:ReturnType<typeof fixture>)=>d.extensions[N].stops.push({...d.extensions[N].stops[0]!,placementId:placement.toUpperCase()}),(d:ReturnType<typeof fixture>)=>d.extensions[N].stops[0]!.viewpointId=crypto.randomUUID(),(d:ReturnType<typeof fixture>)=>d.extensions[N].stops[0]!.placementId=crypto.randomUUID()]){const d=fixture();change(d);expect(validateViewingPlan(d).valid).toBe(false);}
 for(const value of [{version:2,stops:[]},{version:1,stops:[],visitorStyle:'ordered'},{version:1,stops:[{placementId:placement,viewpointId:view,camera:[0,1,0]}]},{version:1,stops:Array(129).fill({placementId:placement,viewpointId:view})}]){const d=fixture();Object.assign(d.extensions,{[N]:value});expect(validateViewingPlan(d).valid).toBe(false);}
});
test('orbit remains authored sculpture-only metadata, with no inferred target or extra fields',()=>{
 for(const orbit of [{minYaw:.1,maxYaw:1},{minYaw:-1,maxYaw:-.1},{minYaw:0,maxYaw:0},{minYaw:-4,maxYaw:1},{minYaw:-1,maxYaw:Infinity},{minYaw:-1,maxYaw:1,target:[0,0,0]}]){const d=fixture();Object.assign(d.extensions[N].stops[0]!,{orbit});expect(validateViewingPlan(d).valid).toBe(false);}
 const d=fixture();d.artworks[0]!.artworkType='image';expect(validateViewingPlan(d).valid).toBe(false);delete (d.extensions[N].stops[0] as {orbit?:unknown}).orbit;expect(validateViewingPlan(d).valid).toBe(true);
});
test('typed remapping retains orbit and only rewrites both declared identities',()=>{
 const d=fixture(),before=structuredClone(d),nextPlacement=crypto.randomUUID(),nextView=crypto.randomUUID();
 const mapped=remapViewingPlan(viewingPlanFor(d),new Map([[placement.toUpperCase(),nextPlacement],[view,nextView]]));expect(mapped.stops[0]).toEqual({placementId:nextPlacement,viewpointId:nextView,orbit:{minYaw:-Math.PI,maxYaw:Math.PI}});expect(d).toEqual(before);expect(()=>remapViewingPlan(viewingPlanFor(d),new Map([[placement,nextPlacement]]))).toThrow('VIEWING_PLAN_REFERENCE');
});

test('explicit setter changes only its own profile and preserves absent versus empty containers',async()=>{
 const {setViewingPlan}=await import('./viewing-plan');
 const source=fixture() as unknown as import('@exhibitos/spec').Exhibition,before=structuredClone(source),plan={version:1 as const,stops:[]};
 const next=setViewingPlan(source,plan);expect(source).toEqual(before);expect(next).toEqual({...source,extensions:{...source.extensions,[N]:plan}});
 const removed=setViewingPlan(next,null),expected=structuredClone(source);delete expected.extensions![N];expect(removed).toEqual(expected);
 const absent=structuredClone(source);delete absent.extensions;expect(setViewingPlan(absent,null)).toEqual(absent);
});
