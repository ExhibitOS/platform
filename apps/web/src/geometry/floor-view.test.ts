// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {newDraft} from '../drafts/example';
import {whiteCubeSurfaces} from './model';
import {floorInteriorView} from './floor-view';
function fixture(){const document=newDraft().candidate,room=document.rooms[0]!;room.dimensions={width:12,height:4,depth:8};document.surfaces=whiteCubeSurfaces(room);return {document,room,floor:document.surfaces.find(s=>s.type==='floor')!,ceiling:document.surfaces.find(s=>s.type==='ceiling')!};}
it('looks at the floor from inside the room rather than below it or above its opaque ceiling',()=>{
 const {document,floor}=fixture(),before=JSON.stringify(document),view=floorInteriorView(document,floor.id)!;
 expect(view.position).toEqual([0,1.65,0]);expect(view.target).toEqual([0,0,0]);expect(view.up[2]).toBeCloseTo(-1);expect(view.near).toBeCloseTo(.0165);expect(JSON.stringify(document)).toBe(before);
});
it('composes translated, rotated and nonuniformly scaled rooms exactly once, preserving floor tangent orientation',()=>{
 const {document,room,floor,ceiling}=fixture();room.transform={position:[10,20,30],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[2,3,4]};floor.transform.position=[1,.2,-.5];ceiling.transform.position[1]=2.2;
 const view=floorInteriorView(document,floor.id)!;
 view.target.forEach((v,i)=>expect(v).toBeCloseTo([8,20.6,28][i]!));view.position.forEach((v,i)=>expect(v).toBeCloseTo([8,24.2,28][i]!));expect(view.up[0]).toBeCloseTo(-1);expect(view.up[1]).toBeCloseTo(0);expect(view.up[2]).toBeCloseTo(0);
});
it('shortens the interior camera and near plane beneath a low authored ceiling without changing the floor',()=>{
 const {document,floor,ceiling}=fixture();ceiling.transform.position[1]=.04;const view=floorInteriorView(document,floor.id)!;
 expect(view.position[1]).toBeCloseTo(.024);expect(view.position[1]).toBeLessThan(.04);expect(view.near).toBeCloseTo(.00024);expect(floor.transform.position[1]).toBe(0);
});
it('refuses unsupported, outside or closed envelopes instead of inventing an exterior camera',()=>{
 const {document,floor,ceiling}=fixture();expect(floorInteriorView(document,ceiling.id)).toBeUndefined();floor.transform.position[0]=6;expect(floorInteriorView(document,floor.id)).toBeUndefined();floor.transform.position[0]=0;ceiling.transform.position[1]=0;expect(floorInteriorView(document,floor.id)).toBeUndefined();
});
