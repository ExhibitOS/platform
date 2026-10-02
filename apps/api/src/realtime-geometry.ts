// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';
import { presentationFor } from '@exhibitos/studio-contract';
type V=[number,number,number];type Q=[number,number,number,number];
export interface PresencePose {roomId:string;position:V;yaw:number}
const add=(a:V,b:V):V=>a.map((n,i)=>n+b[i]!) as V;
const sub=(a:V,b:V):V=>a.map((n,i)=>n-b[i]!) as V;
const rotate=(v:V,q:Q):V=>{const [x,y,z,w]=q,[a,b,c]=v;const tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];};
const inverse=(q:Q):Q=>[-q[0],-q[1],-q[2],q[3]];
const finite=(v:V)=>v.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000);
const radius=.25;
/** Same authored planes/reciprocal doors govern server world poses; no client coordinate is trusted. */
export function createPresenceGeometry(exhibition:Exhibition){
 const transforms=[...exhibition.rooms,...exhibition.surfaces].map(item=>item.transform);
 if(exhibition.units!=='meter'||transforms.some(t=>!finite(t.position)||t.scale.some(n=>n!==1)||t.rotation.some(n=>!Number.isFinite(n))||Math.abs(Math.hypot(...t.rotation)-1)>.001))throw Error('PRESENCE_GEOMETRY_UNSUPPORTED');
 const rooms=new Map(exhibition.rooms.map(r=>[r.id,r]));
 const toWorld=(roomId:string,p:V):V=>{const r=rooms.get(roomId)!;return add(rotate(p,r.transform.rotation),r.transform.position);};
 const fromWorld=(roomId:string,p:V):V=>{const r=rooms.get(roomId)!;return rotate(sub(p,r.transform.position),inverse(r.transform.rotation));};
 const boxes=exhibition.placements.map(placement=>{
  const art=exhibition.artworks.find(a=>a.revisionId===placement.artworkRevisionId),t=placement.transform;
  if(!art||!rooms.has(placement.roomId)||art.units!=='meter'||!finite(t.position)||t.rotation.some(n=>!Number.isFinite(n))||Math.abs(Math.hypot(...t.rotation)-1)>.001||t.scale.some(n=>!Number.isFinite(n)||n<=0||n>100))throw Error('PRESENCE_GEOMETRY_UNSUPPORTED');
  const half:V=[art.dimensions.width*t.scale[0]/2,art.dimensions.height*t.scale[1]/2,Math.max(.002,(art.dimensions.depth??.02)*t.scale[2]/2)];
  if(half.some(n=>!Number.isFinite(n)||n<=0||n>10000))throw Error('PRESENCE_GEOMETRY_UNSUPPORTED');
  return {placement,half};
 });
 const boxLocal=(box:typeof boxes[number],p:V)=>rotate(sub(fromWorld(box.placement.roomId,p),box.placement.transform.position),inverse(box.placement.transform.rotation));
 // Segment versus expanded OBB: conservative capsule envelope, independent of model bytes.
 const boxHit=(box:typeof boxes[number],a:V,b:V)=>{
  const x=boxLocal(box,a),y=boxLocal(box,b);let low=0,high=1;
  for(let i=0;i<3;i++){const bound=box.half[i]!+radius,delta=y[i]!-x[i]!;if(Math.abs(delta)<1e-10){if(Math.abs(x[i]!)>bound)return false;continue;}let p=(-bound-x[i]!)/delta,q=(bound-x[i]!)/delta;if(p>q)[p,q]=[q,p];low=Math.max(low,p);high=Math.min(high,q);if(low>high)return false;}
  return true;
 };
 const surfaces=[...exhibition.surfaces];
 for(const room of exhibition.rooms)if(!surfaces.some(s=>s.roomId===room.id&&s.type==='floor'))surfaces.push({id:`implicit-floor:${room.id}`,roomId:room.id,type:'floor',dimensions:{width:room.dimensions.width,height:room.dimensions.depth},transform:{position:[0,0,0],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}});
 const planes=surfaces.map(surface=>({surface,room:rooms.get(surface.roomId)!}));
 const local=(entry:typeof planes[number],p:V)=>rotate(sub(fromWorld(entry.surface.roomId,p),entry.surface.transform.position),inverse(entry.surface.transform.rotation));
 const pointWorld=(entry:typeof planes[number],p:V)=>toWorld(entry.surface.roomId,add(entry.surface.transform.position,rotate(p,entry.surface.transform.rotation)));
 const doorAt=(entry:typeof planes[number],point:V)=>exhibition.openings.some(o=>o.type==='door'&&o.surfaceId===entry.surface.id&&Math.abs(point[0]-o.offset[0])+radius<=o.dimensions.width/2+.001&&Math.abs(point[1]-o.offset[1])+radius<=o.dimensions.height/2+.001);
 const footprint=(entry:typeof planes[number],p:V,margin=0)=>Math.abs(p[0])<=entry.surface.dimensions.width/2+margin&&Math.abs(p[1])<=entry.surface.dimensions.height/2+margin;
 function ground(position:V,roomId:string){
  const heights:number[]=[];
  for(const entry of planes.filter(p=>p.surface.type==='floor'&&p.surface.roomId===roomId)){
   const center=pointWorld(entry,[0,0,0]),normal=sub(pointWorld(entry,[0,0,1]),center);
   if(normal[1]<Math.cos(35*Math.PI/180))continue;
   const y=center[1]-(normal[0]*(position[0]-center[0])+normal[2]*(position[2]-center[2]))/normal[1];
   const p=local(entry,[position[0],y,position[2]]);
   if(footprint(entry,p)&&position[1]-y>=1.1&&position[1]-y<=2.2)heights.push(y);
  }
  return heights.length?Math.max(...heights):null;
 }
 function valid(pose:PresencePose){
  const r=rooms.get(pose.roomId);if(!r||!finite(pose.position)||!Number.isFinite(pose.yaw)||Math.abs(pose.yaw)>Math.PI)return false;
  const p=fromWorld(r.id,pose.position),d=r.dimensions;
  if(Math.abs(p[0])>d.width/2+.001||Math.abs(p[2])>d.depth/2+.001||p[1]<1.1||p[1]>d.height-.15)return false;
  const floor=ground(pose.position,r.id);if(floor===null)return false;
  const body=[pose.position,[pose.position[0],(pose.position[1]+floor)/2,pose.position[2]] as V,[pose.position[0],floor+.3,pose.position[2]] as V];
  for(const entry of planes.filter(p=>p.surface.type==='wall'))for(const point of body){const p=local(entry,point);if(Math.abs(p[2])<radius-.001&&footprint(entry,p,radius)&&!doorAt(entry,p))return false;}
  const foot:V=[pose.position[0],floor+radius,pose.position[2]],head:V=[pose.position[0],floor+1.75-radius,pose.position[2]];
  if(boxes.some(box=>boxHit(box,foot,head)))return false;
  for(const entry of planes.filter(p=>p.surface.type==='ceiling')){
   const center=pointWorld(entry,[0,0,0]),normal=sub(pointWorld(entry,[0,0,1]),center);
   if(Math.abs(normal[1])<.05)return false;
   const y=center[1]-(normal[0]*(pose.position[0]-center[0])+normal[2]*(pose.position[2]-center[2]))/normal[1];
   if(footprint(entry,local(entry,[pose.position[0],y,pose.position[2]]),radius)&&floor<y&&floor+1.76>y)return false;
  }
  return true;
 }
 function move(previous:PresencePose,next:PresencePose,elapsedMs:number){
  if(!valid(next)||!valid(previous)||elapsedMs<0)return false;
  const distance=Math.hypot(...sub(next.position,previous.position));
  if(distance>2*Math.min(Math.max(elapsedMs,10),500)/1000+.15)return false;
  const turn=Math.abs(next.yaw-previous.yaw),angular=Math.min(turn,2*Math.PI-turn);
  if(angular>12*Math.min(Math.max(elapsedMs,10),500)/1000+.35)return false;
  // Substeps inspect ceilings/support, while swept OBB segments prevent thin-object tunnelling.
  const oldFloor=ground(previous.position,previous.roomId)!,newFloor=ground(next.position,next.roomId)!;
  for(const box of boxes)for(let fraction=0;fraction<=1;fraction+=.05){
   const a:V=[previous.position[0],(oldFloor+radius)*(1-fraction)+(oldFloor+1.75-radius)*fraction,previous.position[2]],b:V=[next.position[0],(newFloor+radius)*(1-fraction)+(newFloor+1.75-radius)*fraction,next.position[2]];
   if(boxHit(box,a,b))return false;
  }
  for(let i=1;i<Math.ceil(distance/.05);i++){const t=i/Math.ceil(distance/.05),position=previous.position.map((n,j)=>n+(next.position[j]!-n)*t) as V;
   if(!valid({roomId:previous.roomId,position,yaw:previous.yaw})&&!valid({roomId:next.roomId,position,yaw:next.yaw}))return false;
  }
  const crossed:string[]=[];
  for(const entry of planes.filter(p=>p.surface.type==='wall')){
   const oldFloor=ground(previous.position,previous.roomId)!,newFloor=ground(next.position,next.roomId)!;
   for(const fraction of [0,.5,1]){
   const oldPoint:[number,number,number]=[previous.position[0],previous.position[1]*(1-fraction)+(oldFloor+.3)*fraction,previous.position[2]],newPoint:[number,number,number]=[next.position[0],next.position[1]*(1-fraction)+(newFloor+.3)*fraction,next.position[2]];
   const a=local(entry,oldPoint),b=local(entry,newPoint);
   if(a[2]*b[2]>=0||Math.abs(a[2]-b[2])<1e-8)continue;
   const t=a[2]/(a[2]-b[2]),hit=a.map((n,i)=>n+(b[i]!-n)*t) as V;
   if(!footprint(entry,hit,radius))continue;
   if(!doorAt(entry,hit))return false;
   crossed.push(entry.surface.id);
   }
  }
  if(previous.roomId!==next.roomId){
   const transition=exhibition.openings.some(o=>o.type==='door'&&crossed.includes(o.surfaceId)&&exhibition.surfaces.find(s=>s.id===o.surfaceId)?.roomId===previous.roomId&&exhibition.openings.some(target=>target.id===o.connectsToOpeningId&&target.type==='door'&&target.connectsToOpeningId===o.id&&exhibition.surfaces.find(s=>s.id===target.surfaceId)?.roomId===next.roomId));
   if(!transition)return false;
  }
  return true;
 }
 function spawn():PresencePose|null {
  const start=presentationFor(exhibition).startCamera;
  if(start&&rooms.has(start.roomId)){const position=toWorld(start.roomId,start.position),target=toWorld(start.roomId,start.target);const pose={roomId:start.roomId,position,yaw:Math.atan2(position[0]-target[0],position[2]-target[2])};if(valid(pose))return pose;}
  for(const r of exhibition.rooms)for(const x of [0,-1,1,-2,2])for(const z of [0,-1,1,-2,2]){const pose={roomId:r.id,position:toWorld(r.id,[x,1.65,z]),yaw:0};if(valid(pose))return pose;}
  return null;
 }
 return {valid,move,spawn};
}
