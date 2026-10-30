// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {applyBenchCommand,applyFurnishingCommand} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {installPrivateCatalogBench} from './catalog-bench-renderer';
import {BENCH_CATALOG} from './catalog-bench';
afterEach(()=>vi.unstubAllGlobals());
it('does not fetch or publish a bench after the graphics context becomes unavailable during authority check',async()=>{
 const doc=newDraft().candidate,room=doc.rooms[0]!,id=crypto.randomUUID(),viewpointId=crypto.randomUUID(),{min,max}=BENCH_CATALOG.bounds;
 const bench={id,name:'bench',roomId:room.id,position:[0,0,0] as [number,number,number],yaw:0,kind:'slab' as const,dimensions:{width:max[0]-min[0],depth:max[2]-min[2],height:.45},material:{preset:'wood' as const,color:'#755741',roughness:.7,metalness:0},viewpointId};
 const d=applyBenchCommand(doc,{type:'add-bench',bench,viewpoint:{id:viewpointId,name:'seat',roomId:room.id,position:[0,1.15,0],target:[0,1.15,-2],fov:50}});
 const candidate=applyFurnishingCommand(d,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}});
 const roomGroup=new three.Group(),host=new three.Group();host.userData.benchId=id;roomGroup.add(host);let release!:()=>void,unavailable=false;
 const check=()=>new Promise<void>(resolve=>{release=resolve;}),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const visual=installPrivateCatalogBench(three,candidate,new Map([[room.id.toLowerCase(),roomGroup]]),[host],new AbortController().signal,check,()=>unavailable,20000,()=>{}),result=visual.start();
 unavailable=true;release();expect(await result).toBe('fallback');expect(fetcher).not.toHaveBeenCalled();expect(host.visible).toBe(true);expect(roomGroup.children).toEqual([host]);visual.dispose();
});
