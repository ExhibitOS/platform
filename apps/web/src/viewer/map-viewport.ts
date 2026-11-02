// SPDX-License-Identifier: AGPL-3.0-or-later
import type {VisitorMap,MapPoint,MapTarget} from './visitor-map';
export type MapViewport=VisitorMap['bounds'];
export const MAP_MAX_ZOOM=8;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export function boundMapViewport(map:VisitorMap,value:MapViewport):MapViewport{
 if(![value.x,value.z,value.width,value.depth].every(Number.isFinite)||value.width<=0||value.depth<=0)return {...map.bounds};
 const aspect=value.width/value.depth,full=Math.max(map.bounds.width,map.bounds.depth*aspect);
 if(!Number.isFinite(aspect)||aspect<=0||!Number.isFinite(full))return {...map.bounds};
 const width=clamp(value.width,full/MAP_MAX_ZOOM,full),depth=width/aspect;
 const x=clamp(value.x+value.width/2,map.bounds.x,map.bounds.x+map.bounds.width),z=clamp(value.z+value.depth/2,map.bounds.z,map.bounds.z+map.bounds.depth);
 const next={x:x-width/2,z:z-depth/2,width,depth};return Object.values(next).every(Number.isFinite)?next:{...map.bounds};
}
/** The fractional cursor/centroid stays over the same world point. */
export function zoomMapViewport(map:VisitorMap,view:MapViewport,factor:number,at:MapPoint=[.5,.5]):MapViewport{
 if(!Number.isFinite(factor)||factor<=0)return view;
 const sized=boundMapViewport(map,{...view,width:view.width/factor,depth:view.depth/factor});
 return boundMapViewport(map,{...sized,x:view.x+at[0]*view.width-at[0]*sized.width,z:view.z+at[1]*view.depth-at[1]*sized.depth});
}
export function panMapViewport(map:VisitorMap,view:MapViewport,dx:number,dz:number):MapViewport{
 return boundMapViewport(map,{...view,x:view.x+dx,z:view.z+dz});
}
export interface SavedMapView {key:string;viewport:MapViewport;selected?:MapTarget;roomId?:string;open:boolean}
const storageKey=(map:VisitorMap)=>'exhibitos-map-view-v1:'+map.key.split('/')[0];
export function readMapView(map:VisitorMap):SavedMapView|undefined{
 try{
  const raw=sessionStorage.getItem(storageKey(map));if(!raw||raw.length>2048)return;
  const value=JSON.parse(raw) as SavedMapView;
  if(value.key!==map.key){sessionStorage.removeItem(storageKey(map));return;}
  if(!value.viewport||typeof value.open!=='boolean')return;
  const selected=value.selected&&(value.selected.kind==='room'?map.rooms:value.selected.kind==='placement'?map.placements:[]).some(p=>p.id===value.selected!.id)?value.selected:undefined;
  return {key:map.key,viewport:boundMapViewport(map,value.viewport),open:value.open,selected:selected?{kind:selected.kind,id:selected.id}:undefined,roomId:map.rooms.some(r=>r.id===value.roomId)?value.roomId:undefined};
 }catch{return;}
}
export function saveMapView(map:VisitorMap,value:SavedMapView){try{const bytes=JSON.stringify(value);if(bytes.length<=2048)sessionStorage.setItem(storageKey(map),bytes);}catch{/* This tab's optional UI state never gates viewing. */}}
