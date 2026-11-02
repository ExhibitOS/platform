// SPDX-License-Identifier: AGPL-3.0-or-later
import type {MapPoint,MapSelection,VisitorMap} from './visitor-map';

type Placement=VisitorMap['placements'][number]&{facing?:MapPoint};
export interface DisplayMarker {id:string;anchor:MapPoint;point?:MapPoint}
type Edge={a:MapPoint;normal:MapPoint;tangent:MapPoint};
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

/** Room-constrained label positions. Input points and identities remain untouched.
 * Optional facing is the producer's actual image-plane normal, not a guessed
 * GLB front. Legacy data uses only its own room boundary as a visual fallback.
 */
export function layoutMapMarkers(map:VisitorMap,width:number,height:number,markerSize=44):DisplayMarker[]{
 if(!(width>0&&height>0&&map.bounds.width>0&&map.bounds.depth>0))return map.placements.map(p=>({id:p.id,anchor:p.point}));
 const scale:MapPoint=[width/map.bounds.width,height/map.bounds.depth];
 const pixel=(p:MapPoint):MapPoint=>[(p[0]-map.bounds.x)*scale[0],(p[1]-map.bounds.z)*scale[1]];
 const world=(p:MapPoint):MapPoint=>[p[0]/scale[0]+map.bounds.x,p[1]/scale[1]+map.bounds.z];
 const placed=new Map<string,MapPoint>(),half=markerSize/2+6,spacing=markerSize+4;
 const rooms=new Map(map.rooms.map(room=>[room.id.toLowerCase(),room]));
 for(const room of rooms.values()){
  const polygon=room.outline.map(pixel);
  const area=polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length]!;return sum+a[0]*b[1]-b[0]*a[1];},0);
  if(!Number.isFinite(area)||Math.abs(area)<1e-6)continue;
  const edges:Edge[]=polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length]!,length=distance(a,b),sign=area>0?1:-1;return {a,tangent:[(b[0]-a[0])/length,(b[1]-a[1])/length] as MapPoint,normal:[-(b[1]-a[1])*sign/length,(b[0]-a[0])*sign/length] as MapPoint};});
  if(edges.some(e=>!e.normal.every(Number.isFinite)))continue;
  const signed=(p:MapPoint,e:Edge)=>dot([p[0]-e.a[0],p[1]-e.a[1]],e.normal);
  // The support of an axis-aligned square against each inward half-plane keeps
  // the complete visual/hit target inside rotated rooms, including corners.
  const inset=(e:Edge)=>half*(Math.abs(e.normal[0])+Math.abs(e.normal[1]));
  const inside=(p:MapPoint)=>edges.every(e=>signed(p,e)>=inset(e)-1e-5);
  const constrain=(value:MapPoint)=>{
   const p:MapPoint=[...value];
   for(let pass=0;pass<12;pass++)for(const e of edges){const missing=inset(e)-signed(p,e);if(missing>0){p[0]+=e.normal[0]*missing;p[1]+=e.normal[1]*missing;}}
   return inside(p)?p:undefined;
  };
  // Room controls live outside the drawing. They never evict an artwork target.
  const occupied:MapPoint[]=[];
  const items=map.placements.filter(p=>p.roomId.toLowerCase()===room.id.toLowerCase()).slice().sort((a,b)=>a.id.localeCompare(b.id));
  for(const item of items){
   const anchor=pixel(item.point),facing=(item as Placement).facing;
   const direction:MapPoint|undefined=facing&&facing.every(Number.isFinite)&&Math.hypot(...facing)>1e-6?[facing[0]*scale[0],facing[1]*scale[1]]:undefined;
   const near=edges.slice().sort((a,b)=>Math.abs(signed(anchor,a))-Math.abs(signed(anchor,b)));
   // At a corner the image face disambiguates the room-side layout axis.
   // This does not create a wall binding or change the artwork's actual anchor.
   const closest=Math.abs(signed(anchor,near[0]!));
   const candidates=near.filter(e=>Math.abs(signed(anchor,e))<=closest+markerSize);
   const edge=item.artworkType==='image'&&direction?candidates.sort((a,b)=>dot(b.normal,direction)-dot(a.normal,direction))[0]!:near[0]!;
   const base=constrain(anchor);if(!base)continue;
   const choices:MapPoint[]=[];
   for(let row=0;row<=6;row++)for(let along=-6;along<=6;along++){
    if(row+Math.abs(along)>6)continue;
    const p=constrain([base[0]+(edge.normal[0]*row+edge.tangent[0]*along)*spacing,base[1]+(edge.normal[1]*row+edge.tangent[1]*along)*spacing]);
    if(p&&!choices.some(q=>distance(p,q)<1))choices.push(p);
   }
   choices.sort((a,b)=>distance(a,anchor)-distance(b,anchor));
   const point=choices.find(p=>occupied.every(q=>Math.abs(p[0]-q[0])>=spacing||Math.abs(p[1]-q[1])>=spacing));
   if(point){placed.set(item.id,world(point));occupied.push(point);}
  }
 }
 return map.placements.map(p=>({id:p.id,anchor:p.point,point:placed.get(p.id)}));
}
