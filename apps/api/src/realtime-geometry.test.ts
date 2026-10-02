// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {createPresenceGeometry} from './realtime-geometry.ts';
async function scene(){const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;e.rooms=e.rooms.slice(0,1);e.surfaces=e.surfaces.filter(s=>s.roomId===e.rooms[0]!.id);e.openings=[];e.placements=[];return e;}
it('rejects swept rotated/scaled artwork collision while accepting clear walking and mounted paintings',async()=>{
 const e=await scene(),roomId=e.rooms[0]!.id;const p={roomId,position:[-.55,1.65,0] as [number,number,number],yaw:0},q={...p,position:[.55,1.65,0] as [number,number,number]};
 expect(createPresenceGeometry(e).move(p,q,500)).toBe(true);
 const art=e.artworks[0]!;art.dimensions={width:.05,height:2,depth:.8};e.placements=[{id:'10000000-0000-4000-8000-000000000001',roomId,artworkRevisionId:art.revisionId,assetId:art.primaryAssetId,transform:{position:[0,1,0],rotation:[0,Math.sin(.1),0,Math.cos(.1)],scale:[2,1,1]}}];
 const geometry=createPresenceGeometry(e);expect(geometry.valid(p)).toBe(true);expect(geometry.valid(q)).toBe(true);expect(geometry.move(p,q,500)).toBe(false);expect(geometry.valid({...p,position:[0,1.65,0]})).toBe(false);
 art.dimensions={width:1,height:1,depth:.02};e.placements[0]!.transform={position:[0,1.5,-e.rooms[0]!.dimensions.depth/2],rotation:[0,0,0,1],scale:[1,1,1]};expect(createPresenceGeometry(e).move(p,q,500)).toBe(true);
});
it('rejects low authored ceilings and non-rigid space instead of ignoring transforms',async()=>{
 const e=await scene(),roomId=e.rooms[0]!.id,floor={id:'30000000-0000-4000-8000-000000000003',roomId,type:'floor' as const,dimensions:{width:12,height:8},transform:{position:[0,0,0] as [number,number,number],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2] as [number,number,number,number],scale:[1,1,1] as [number,number,number]}};
 e.surfaces.push({...structuredClone(floor),id:'20000000-0000-4000-8000-000000000002',type:'ceiling',transform:{...floor.transform,position:[0,1.7,0]}});
 expect(createPresenceGeometry(e).valid({roomId,position:[0,1.65,0],yaw:0})).toBe(false);
 e.rooms[0]!.transform.scale=[2,1,1];expect(()=>createPresenceGeometry(e)).toThrow('PRESENCE_GEOMETRY_UNSUPPORTED');
});
