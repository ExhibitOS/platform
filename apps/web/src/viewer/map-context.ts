// SPDX-License-Identifier: AGPL-3.0-or-later
import type {MapPoint,VisitorMap} from './visitor-map';

/** Display-only room crops. Never a navigation room/destination certificate. */
export function createMapContext(map:VisitorMap){
 const rooms=map.rooms.map(room=>{
  const xs=room.outline.map(p=>p[0]),zs=room.outline.map(p=>p[1]);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...zs),bottom=Math.max(...zs);
  // Context outside every wall includes the admitted door and the first part of
  // adjacent spaces. The diagonal plus margin fits corners within the circle,
  // clear of its top-right 44px expansion control even in the 128px circle.
  // The room diagonal occupies at most 1/1.7 of the diameter, including very
  // large square rooms where capped metre padding alone would be inadequate.
  const pad=Math.max(.75,Math.min(2,Math.max(right-left,bottom-top)*.12));
  const span=Math.max(Math.hypot(right-left+pad*2,bottom-top+pad*2)*1.18,Math.hypot(right-left,bottom-top)*1.7);
  return {id:room.id,outline:room.outline,left,right,top,bottom,margin:Math.min(.2,Math.min(right-left,bottom-top)*.15),crop:{x:(left+right-span)/2,z:(top+bottom-span)/2,width:span,depth:span}};
 });
 const classify=(room:typeof rooms[number],p:MapPoint)=>{
  if(p[0]<room.left-.25||p[0]>room.right+.25||p[1]<room.top-.25||p[1]>room.bottom+.25)return {inside:false,distance:Infinity};
  let inside=false,distance=Infinity;
  for(let i=0,j=room.outline.length-1;i<room.outline.length;j=i++){
   const a=room.outline[j]!,b=room.outline[i]!,dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz;
   const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den)):0;
   distance=Math.min(distance,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz));
   if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return {inside:inside||distance<1e-7,distance};
 };
 const span=Math.hypot(map.bounds.width,map.bounds.depth)*1.12;
 const fallback={x:map.bounds.x+(map.bounds.width-span)/2,z:map.bounds.z+(map.bounds.depth-span)/2,width:span,depth:span};
 return {select(p:MapPoint|undefined,previous?:string){
  const retained=rooms.find(r=>r.id===previous);
  if(!p)return {roomId:retained?.id,bounds:retained?.crop??fallback};
  if(retained){const value=classify(retained,p);if(value.inside||value.distance<=retained.margin)return {roomId:retained.id,bounds:retained.crop};}
  const found=rooms.find(room=>classify(room,p).inside);
  // In the short gap between connected doors retain the previous context.
  const gap=retained&&p[0]>=retained.crop.x&&p[0]<=retained.crop.x+retained.crop.width&&p[1]>=retained.crop.z&&p[1]<=retained.crop.z+retained.crop.depth?retained:undefined;
  return {roomId:found?.id??gap?.id,bounds:found?.crop??gap?.crop??fallback};
 }};
}
