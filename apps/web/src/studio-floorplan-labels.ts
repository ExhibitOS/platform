// SPDX-License-Identifier: AGPL-3.0-or-later
interface Point {x:number;z:number}
interface Anchor extends Point {id:string}
interface Frame {left:number;top:number;span:number}
export const ARTWORK_MARKER_RADIUS=.07;

export function artworkLabelLayout(anchors:readonly Anchor[],{left,top,span}:Frame){
 const radius=span/30;
 const separation=2*radius+span/120;
 const visible=anchors.filter(({x,z})=>x>=left&&x<=left+span&&z>=top&&z<=top+span);
 const markers=new Map<string,Point[]>(),badges=new Map<string,Point[]>();
 const positions=new Map<string,Point>();
 const cell=(value:number)=>Math.floor(value/separation);
 const key=(x:number,z:number)=>x+':'+z;
 function add(grid:Map<string,Point[]>,point:Point){
  const bin=key(cell(point.x),cell(point.z));
  const points=grid.get(bin);
  if(points)points.push(point);else grid.set(bin,[point]);
 }
 function near(grid:Map<string,Point[]>,point:Point,distance:number){
  const x=cell(point.x),z=cell(point.z),limit=distance*distance,reach=Math.ceil(distance/separation);
  for(let dx=-reach;dx<=reach;dx++)for(let dz=-reach;dz<=reach;dz++){
   if(grid.get(key(x+dx,z+dz))?.some(other=>(other.x-point.x)**2+(other.z-point.z)**2<limit))return true;
  }
  return false;
 }
 for(const anchor of visible)add(markers,anchor);
 // Start close to the anchor, then try the nearest grid positions. A crowded
 // area can omit badges while keeping its exact markers and numbered list.
 const offsets:Point[]=[{x:0,z:-1.35*radius}];
 for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++){
  if((x||z)&&Math.hypot(x*separation,z*separation)<=span*.18)offsets.push({x:x*separation,z:z*separation});
 }
 offsets.sort((a,b)=>(a.x*a.x+a.z*a.z)-(b.x*b.x+b.z*b.z)||a.z-b.z||a.x-b.x);
 for(const anchor of visible){
  for(const offset of offsets){
   const point={x:anchor.x+offset.x,z:anchor.z+offset.z};
   if(point.x-radius<left||point.x+radius>left+span||point.z-radius<top||point.z+radius>top+span)continue;
   if(near(badges,point,separation)||near(markers,point,radius+ARTWORK_MARKER_RADIUS))continue;
   positions.set(anchor.id,point);
   add(badges,point);
   break;
  }
 }
 return {positions,radius,fontSize:span/40};
}
