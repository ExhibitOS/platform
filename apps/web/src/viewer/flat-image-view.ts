// SPDX-License-Identifier: AGPL-3.0-or-later
import type {DetailView} from './detail-gesture';
export interface ImageViewport {width:number;height:number;imageWidth:number;imageHeight:number;pixelRatio:number}
export function imageFit(v:ImageViewport){
 const scale=Math.min(v.width/v.imageWidth,v.height/v.imageHeight);
 const width=v.imageWidth*scale,height=v.imageHeight*scale;
 return {width,height,maxZoom:Math.max(1,1/(scale*v.pixelRatio))};
}
export function flatImageView(view:DetailView,v:ImageViewport):DetailView{
 const fit=imageFit(v),zoom=Math.max(1,Math.min(fit.maxZoom,view.zoom));
 const x=Math.max(0,(fit.width*zoom-v.width)/2),y=Math.max(0,(fit.height*zoom-v.height)/2);
 return {yaw:0,pitch:0,zoom,panX:Math.max(-x,Math.min(x,view.panX??0)),panY:Math.max(-y,Math.min(y,view.panY??0))};
}
/** Zoom about a pointer in CSS pixels relative to the host centre. */
export function zoomImage(view:DetailView,zoom:number,x:number,y:number,v:ImageViewport):DetailView{
 const bounded=flatImageView({...view,zoom},v),ratio=bounded.zoom/view.zoom;
 return flatImageView({...bounded,panX:x- (x-(view.panX??0))*ratio,panY:y-(y-(view.panY??0))*ratio},v);
}
interface Point{x:number;y:number}
export class FlatImageGesture{
 private points=new Map<number,Point>();
 begin(id:number,p:Point){if(this.points.size<2)this.points.set(id,p);}
 move(id:number,p:Point,view:DetailView,v:ImageViewport):DetailView{
  const old=this.points.get(id);if(!old)return view;
  const other=[...this.points].find(([key])=>key!==id)?.[1];this.points.set(id,p);
  if(other){const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(p.x-other.x,p.y-other.y);
   if(before<=2||after<=2)return view;
   const middle={x:(old.x+other.x)/2,y:(old.y+other.y)/2};
   const next=zoomImage(view,view.zoom*after/before,middle.x,middle.y,v);
   return flatImageView({...next,panX:(next.panX??0)+(p.x-old.x)/2,panY:(next.panY??0)+(p.y-old.y)/2},v);
  }
  return flatImageView({...view,panX:(view.panX??0)+p.x-old.x,panY:(view.panY??0)+p.y-old.y},v);
 }
 end(id:number){this.points.delete(id);}clear(){this.points.clear();}
}
