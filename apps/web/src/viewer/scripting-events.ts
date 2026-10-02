// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import type {SpatialEvent} from '@exhibitos/studio-contract';
import {occlusionGain} from './audio-geometry';
type Vec=[number,number,number];
function rotate(p:Vec,q:[number,number,number,number]):Vec{const[x,y,z,w]=q,[a,b,c]=p,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return[a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];}
function world(doc:Exhibition,roomId:string,p:Vec):Vec{const r=doc.rooms.find(r=>r.id===roomId);if(!r)return p;return rotate(p,r.transform.rotation).map((v,i)=>v+r.transform.position[i]!) as Vec;}
/** Approach radius1.5m; look within10m and10degree cone, wall-visible500ms dwell.
 * These host thresholds generate edges, never events every animation frame. */
export class ScriptEdges {
 private room:string|undefined;private zones=new Set<string>();private approached=new Set<string>();private looked=new Set<string>();private dwell=new Map<string,number>();
 constructor(private doc:Exhibition){}
 update(position:Vec,forward:Vec,now:number):SpatialEvent[]{if(![...position,...forward,now].every(Number.isFinite))return[];const events:SpatialEvent[]=[];
  const room=this.doc.rooms.find(r=>{const p=rotate(position.map((v,i)=>v-r.transform.position[i]!) as Vec,[-r.transform.rotation[0],-r.transform.rotation[1],-r.transform.rotation[2],r.transform.rotation[3]]);return Math.abs(p[0])<=r.dimensions.width/2&&Math.abs(p[2])<=r.dimensions.depth/2&&p[1]>=0&&p[1]<=r.dimensions.height;})?.id;
  if(room!==this.room){if(this.room)events.push({type:'room_leave',roomId:this.room});if(room)events.push({type:'room_enter',roomId:room});this.room=room;}
  const zones=new Set(this.doc.audioZones.filter(z=>Math.hypot(...world(this.doc,z.roomId,z.position).map((v,i)=>v-position[i]!))<z.radius).map(z=>z.id));
  for(const id of this.zones)if(!zones.has(id))events.push({type:'zone_leave',zoneId:id});for(const id of zones)if(!this.zones.has(id))events.push({type:'zone_enter',zoneId:id});this.zones=zones;
  for(const p of this.doc.placements){const target=world(this.doc,p.roomId,p.transform.position),delta=target.map((v,i)=>v-position[i]!) as Vec,distance=Math.hypot(...delta),visible=occlusionGain(this.doc,position,target,0)>0;
   const close=distance<1.5&&visible;if(close&&!this.approached.has(p.id))events.push({type:'artwork_approach',placementId:p.id});if(close)this.approached.add(p.id);else this.approached.delete(p.id);
   const length=Math.hypot(...forward),look=visible&&distance>0.001&&distance<=10&&length>0&&delta.reduce((sum,v,i)=>sum+v*forward[i]!,0)/(distance*length)>=Math.cos(Math.PI/18);
   if(look){if(!this.dwell.has(p.id))this.dwell.set(p.id,now);if(now-this.dwell.get(p.id)!>=500&&!this.looked.has(p.id)){this.looked.add(p.id);events.push({type:'artwork_look',placementId:p.id});}}else{this.dwell.delete(p.id);this.looked.delete(p.id);}
  }return events;
 }
}
