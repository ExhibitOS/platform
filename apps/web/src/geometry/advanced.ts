// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';
import {newSurface,type Room,type Surface} from './model';
const q=Math.SQRT1_2;
const pose=(position:[number,number,number],rotation:[number,number,number,number])=>({position,rotation,scale:[1,1,1] as [number,number,number]});
function finite(values:number[]){if(values.some(n=>!Number.isFinite(n)))throw Error('유한한 건축 치수를 입력하세요.');}
/** Chord walls use identical persisted planes in the renderer and physics engine. */
export function curvedWall(room:Room,radius:number,sweepDegrees:number,segments:number,height:number):Surface[]{
 finite([radius,sweepDegrees,segments,height]);
 if(radius<.5||radius>100||sweepDegrees<5||sweepDegrees>360||!Number.isInteger(segments)||segments<2||segments>32||height<.5||height>room.dimensions.height)throw Error('곡선벽 범위: 반경 0.5..100m, 각도5..360°, 구간2..32, 높이는 방 이하');
 const sweep=sweepDegrees*Math.PI/180, step=sweep/segments;
 return Array.from({length:segments},(_,i)=>{
 const a=-sweep/2+i*step,b=a+step,x=(Math.sin(a)+Math.sin(b))*radius/2,z=(Math.cos(a)+Math.cos(b))*radius/2,angle=(a+b)/2;
 return newSurface(room.id,'wall',{width:2*radius*Math.sin(step/2),height},pose([x,height/2,z],[0,Math.sin(angle/2),0,Math.cos(angle/2)]));
 });
}
/** +Z ascent. Exact tread/riser planes; accessible ramps are separate continuous floors. */
export function staircase(room:Room,width:number,rise:number,run:number,count:number):Surface[]{
 finite([width,rise,run,count]);if(width<.6||width>10||rise<=0||rise>.25||run<.3||run>2||!Number.isInteger(count)||count<1||count>24||rise*count+1.75>room.dimensions.height)throw Error('계단 범위: 폭0.6..10m, 단차0..0.25m, 디딤0.3..2m, 1..24단 및 머리 여유');
 return Array.from({length:count},(_,i)=>[
 newSurface(room.id,'floor',{width,height:run},pose([0,(i+1)*rise,(i+.5)*run],[ -q,0,0,q])),
 newSurface(room.id,'wall',{width,height:rise},pose([0,(i+.5)*rise,i*run],[0,0,0,1]))
 ]).flat();
}
export function ramp(room:Room,width:number,rise:number,run:number):Surface[]{
 finite([width,rise,run]);if(width<1||width>10||rise<=0||run+1e-9<rise*12||run>100||rise+1.75>room.dimensions.height)throw Error('경사로 폭≥1m, 기울기≤1:12, 길이≤100m 및 머리 여유가 필요합니다.');
 const angle=-Math.atan2(rise,run)-Math.PI/2;
 return [newSurface(room.id,'floor',{width,height:Math.hypot(rise,run)},pose([0,rise/2,run/2],[Math.sin(angle/2),0,0,Math.cos(angle/2)]))];
}
export function appendArchitecture(doc:Exhibition,surfaces:Surface[]):Exhibition {
 const next=structuredClone(doc);if(next.surfaces.length+surfaces.length>256)throw Error('표면 한도256개');next.surfaces.push(...surfaces);return next;
}
