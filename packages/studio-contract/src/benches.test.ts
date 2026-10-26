// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {BENCH_NAMESPACE as N,applyBenchCommand,benchesFor,remapStudioBenches,validateStudioBenches} from './benches.js';
import type {StudioBench,StudioBenches} from './benches.js';
import {PRESENTATION_NAMESPACE as P} from './index.js';
import {benchBoxes,benchSolids} from './bench-geometry.js';
const room='aaaaaaaa-0000-4000-8000-000000000001',view='aaaaaaaa-0000-4000-8000-000000000002',id='aaaaaaaa-0000-4000-8000-000000000003';
const bench=():StudioBench=>({id,name:'Quiet bench',roomId:room,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:1.5,depth:.6,height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId:view});
function fixture():Exhibition{return {rooms:[{id:room,dimensions:{width:10,depth:10,height:3},transform:{position:[4,0,2],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[1,1,1]}}],extensions:{'org.example/opaque':{text:id},[P]:{version:1,viewpoints:[{id:view,name:'Look at the work',roomId:room,position:[0,1.15,0],target:[0,1,-2],fov:50}],credits:'Keep me'},[N]:{version:1,benches:[bench()]}}} as unknown as Exhibition;}
test('legacy absence, two bounded presets and world transform preserve source and artwork data',()=>{
  const d=fixture(),before=structuredClone(d);expect(validateStudioBenches(d).valid).toBe(true);expect(benchBoxes(bench())).toHaveLength(5);expect(benchBoxes({...bench(),kind:'backed'})).toHaveLength(7);expect(benchSolids(d)).toHaveLength(5);expect(d).toEqual(before);
  delete d.extensions![N];expect(validateStudioBenches(d).valid).toBe(true);expect(benchesFor(d)).toEqual([]);expect(benchSolids(d)).toEqual([]);
});
test('rejects malformed, dangling, duplicate, out-of-room or unsafe seat metadata before allocations',()=>{
  for(const change of [(b:Record<string,unknown>)=>b.extra=true,b=>b.kind='asset',b=>b.kind=['slab'],b=>b.material={...bench().material,preset:['wood']},b=>b.roomId=id,b=>b.viewpointId=id,b=>b.yaw=NaN,b=>b.position=[5,0,0],b=>b.dimensions={width:.1,depth:.6,height:.45},b=>b.material={...bench().material,texture:'file:///private'}]){
    const d=fixture();change((d.extensions![N] as unknown as StudioBenches).benches[0] as unknown as Record<string,unknown>);expect(validateStudioBenches(d).valid).toBe(false);
  }
  const d=fixture(),value=d.extensions![N] as unknown as StudioBenches;value.benches.push({...bench(),id:id.toUpperCase()});expect(validateStudioBenches(d).valid).toBe(false);
  value.benches=Array.from({length:33},()=>bench());expect(validateStudioBenches(d).errors[0]!.code).toBe('BENCH_LIMIT');
  const bad=fixture();(bad.extensions![P] as unknown as {viewpoints:{position:number[]}[]}).viewpoints[0]!.position=[0,.5,0];expect(validateStudioBenches(bad).valid).toBe(false);
});
test('rejects generated world geometry outside the shared affine cap before renderer allocation',()=>{const d=fixture();d.rooms[0]!.transform.position=[10000,0,0];expect(validateStudioBenches(d).valid).toBe(false);expect(()=>benchSolids(d)).toThrow('BENCH_INVALID');});
test('typed remap changes only identities, never UUID-shaped prose or source',()=>{
  const d=fixture(),value=d.extensions![N] as unknown as StudioBenches;value.benches[0]!.name=id;const before=structuredClone(value),ids=new Map([id,room,view].map((v,i)=>[v,`bbbbbbbb-0000-4000-8000-00000000000${i+1}`]));
  const mapped=remapStudioBenches(value,ids);expect(mapped.benches[0]).toMatchObject({id:ids.get(id),roomId:ids.get(room),viewpointId:ids.get(view),name:id});expect(value).toEqual(before);expect(()=>remapStudioBenches(value,new Map())).toThrow('BENCH_REFERENCE');
});
test('fresh viewpoint creation is atomic; shared viewpoints and unknown namespaces survive edit/remove',()=>{
  const d=fixture(),fresh=crypto.randomUUID(),nextBench={...bench(),id:crypto.randomUUID(),viewpointId:fresh};
  const next=applyBenchCommand(d,{type:'add-bench',bench:nextBench,viewpoint:{id:fresh,name:'New seat',roomId:room,position:[0,1.15,0],target:[0,1,-2],fov:50}});
  expect(validateStudioBenches(next).valid).toBe(true);expect(benchesFor(d)).toHaveLength(1);expect(next.extensions!['org.example/opaque']).toEqual(d.extensions!['org.example/opaque']);
  expect(()=>applyBenchCommand(d,{type:'set-bench',bench:bench(),viewpoint:{id:view,name:'Overwrite',roomId:room,position:[0,1.15,0],target:[0,1,-2],fov:50}})).toThrow('BENCH_REFERENCE');
  const removed=applyBenchCommand(next,{type:'remove-bench',benchId:nextBench.id});expect(removed.extensions![P]).toEqual(next.extensions![P]);expect(benchesFor(removed)).toHaveLength(1);
});
