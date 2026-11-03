// SPDX-License-Identifier: AGPL-3.0-or-later
import type {MapPoint,MapSelection,VisitorMap} from './visitor-map';

export interface DisplayMarker {id:string;anchor:MapPoint;point?:MapPoint}
type Edge={a:MapPoint;normal:MapPoint};
const dot=(a:MapPoint,b:MapPoint)=>a[0]*b[0]+a[1]*b[1];
const distance=(a:MapPoint,b:MapPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

/** Visual range only. Never a camera far plane, visibility or travel distance. */
export function mapFanRadius(worldSpan:number,pixelSpan:number){
 return Math.min(2,worldSpan*.12,24*worldSpan/Math.max(1,pixelSpan));
}

/** A drawing viewport only. Room/artwork anchors and travel identities are not
 * transformed. A square keeps long rooms usable without a tall mobile panel. */
export function mapRoomViewport(map:VisitorMap,roomId:string|undefined):VisitorMap{
 const room=roomId&&map.rooms.find(r=>r.id.toLowerCase()===roomId.toLowerCase());
 if(!room)return map;
 const xs=room.outline.map(p=>p[0]),zs=room.outline.map(p=>p[1]);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),span=Math.max(maxX-minX,maxZ-minZ)*1.1;
 if(!Number.isFinite(span)||span<=0)return map;
 return {...map,rooms:[room],doors:map.doors.filter(d=>d.roomId.toLowerCase()===room.id.toLowerCase()),placements:map.placements.filter(p=>p.roomId.toLowerCase()===room.id.toLowerCase()),bounds:{x:(minX+maxX-span)/2,z:(minZ+maxZ-span)/2,width:span,depth:span}};
}

/** Unmounting a responsive marker need not fire blur/pointerleave. Keep the
 * explicit selection, but never let an invisible temporary preview shadow it.
 */
export function reconcileMapMarkerPreview(value:MapSelection,visible:ReadonlySet<string>):MapSelection{
 const vanished=(target:MapSelection['focused'])=>target?.kind==='placement'&&!visible.has(target.id);
 if(!vanished(value.hovered)&&!vanished(value.focused))return value;
 const next={...value};if(vanished(next.hovered))delete next.hovered;if(vanished(next.focused))delete next.focused;
 return next;
}

/** Display targets never establish a wall attachment. Images may move only
 * along their actual plane normal, just far enough to fit inside their room.
 * This leaves the along-plane coordinate/order exact. Dense or unsupported
 * targets use the existing room/list paths instead of extra rows or wall guesses.
 * Sculpture targets stay at their actual floor anchor, or use the list.
 */
export function layoutMapMarkers(map:VisitorMap,width:number,height:number,markerSize=44,retained?:ReadonlySet<string>):DisplayMarker[]{
 if(!(width>0&&height>0&&map.bounds.width>0&&map.bounds.depth>0))return map.placements.map(p=>({id:p.id,anchor:p.point}));
 const scale:MapPoint=[width/map.bounds.width,height/map.bounds.depth];
 const pixel=(p:MapPoint):MapPoint=>[(p[0]-map.bounds.x)*scale[0],(p[1]-map.bounds.z)*scale[1]];
 const world=(p:MapPoint):MapPoint=>[p[0]/scale[0]+map.bounds.x,p[1]/scale[1]+map.bounds.z];
 const placed=new Map<string,MapPoint>(),half=markerSize/2+6,occupied:{point:MapPoint;retained:boolean}[]=[];
 for(const room of map.rooms){
  const polygon=room.outline.map(pixel);
  const area=polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length]!;return sum+a[0]*b[1]-b[0]*a[1];},0);
  if(!Number.isFinite(area)||Math.abs(area)<1e-6)continue;
  const edges:Edge[]=polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length]!,length=distance(a,b),sign=area>0?1:-1;return {a,normal:[-(b[1]-a[1])*sign/length,(b[0]-a[0])*sign/length] as MapPoint};});
  if(edges.some(e=>!e.normal.every(Number.isFinite)))continue;
  const signed=(p:MapPoint,e:Edge)=>dot([p[0]-e.a[0],p[1]-e.a[1]],e.normal);
  const inset=(e:Edge)=>half*(Math.abs(e.normal[0])+Math.abs(e.normal[1]));
  const inside=(p:MapPoint)=>edges.every(e=>signed(p,e)>=inset(e)-1e-5);
  const items=map.placements.filter(p=>p.roomId.toLowerCase()===room.id.toLowerCase()).slice().sort((a,b)=>Number(retained?.has(b.id)??false)-Number(retained?.has(a.id)??false)||a.point[0]-b.point[0]||a.point[1]-b.point[1]||a.id.localeCompare(b.id));
  for(const item of items){
   const anchor=pixel(item.point);let point=anchor;
   if(item.artworkType==='image'&&item.facing){
    const direction:MapPoint=[item.facing[0]*scale[0],item.facing[1]*scale[1]],length=Math.hypot(...direction);
    if(!Number.isFinite(length)||length<1e-6)continue;
    direction[0]/=length;direction[1]/=length;
    let move=0;
    for(const edge of edges){
     const missing=inset(edge)-signed(anchor,edge),toward=dot(direction,edge.normal);
     if(missing>1e-5){if(toward<=1e-7){move=Infinity;break;}move=Math.max(move,missing/toward);}
    }
    // A single target-width is the entire display displacement budget. Never
    // slide along a wall, search other walls, or pack another inward row.
    if(move>markerSize)continue;
    point=[anchor[0]+direction[0]*move,anchor[1]+direction[1]*move];
   }
   if(!inside(point)||occupied.some(q=>{const spacing=markerSize+(q.retained&&retained?.has(item.id)?2:6);return Math.abs(point[0]-q.point[0])<spacing&&Math.abs(point[1]-q.point[1])<spacing;}))continue;
   placed.set(item.id,world(point));occupied.push({point,retained:retained?.has(item.id)??false});
  }
 }
 return map.placements.map(p=>({id:p.id,anchor:p.point,point:placed.get(p.id)}));
}
