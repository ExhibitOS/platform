// SPDX-License-Identifier: AGPL-3.0-or-later
export interface PresenceVisitor {visitorId:string;displayName:string;roomId:string;position:[number,number,number];yaw:number}
interface Frame {at:number;visitor:PresenceVisitor}
/** Two bounded samples,100ms interpolation delay; no extrapolation, >5m teleports snap.
 * Reduced motion renders the current authoritative sample immediately. */
export class PresenceMotion {
 private frames=new Map<string,{previous:Frame;current:Frame}>();
 update(visitors:readonly PresenceVisitor[],now:number){const ids=new Set(visitors.map(v=>v.visitorId));for(const id of this.frames.keys())if(!ids.has(id))this.frames.delete(id);for(const visitor of visitors){const current={at:now,visitor:structuredClone(visitor)},old=this.frames.get(visitor.visitorId)?.current;const jump=old&&Math.hypot(...visitor.position.map((v,i)=>v-old.visitor.position[i]!))>5;this.frames.set(visitor.visitorId,{previous:!old||jump?current:old,current});}}
 sample(now:number,reducedMotion=false):PresenceVisitor[]{return [...this.frames.values()].map(({previous,current})=>{const span=current.at-previous.at,t=reducedMotion||span<=0?1:Math.max(0,Math.min(1,(now-100-previous.at)/span));const turn=Math.atan2(Math.sin(current.visitor.yaw-previous.visitor.yaw),Math.cos(current.visitor.yaw-previous.visitor.yaw));return {...structuredClone(current.visitor),position:current.visitor.position.map((v,i)=>previous.visitor.position[i]!+(v-previous.visitor.position[i]!)*t) as [number,number,number],yaw:previous.visitor.yaw+turn*t};});}
 clear(){this.frames.clear();}
}
