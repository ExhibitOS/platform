// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {artifactCorners,benchBoxes,benchesFor,furnishingsFor,installationFor,installationPlane,wallFinishesFor} from '@exhibitos/studio-contract';
import type {SupportContact} from './shadows';
import {rectangularGroundContact,type RectangularGroundContact} from './ground-contact-footprint';

type Rectangle = {x:number;y:number;width:number;height:number};
type Receiver = {group:Three.Group;rectangles:readonly Rectangle[];faceZ:number};

// Bounded contact descriptors and matrix/uniform state; compiled-program
// storage is driver-owned and is not represented by this byte estimate.
// 64 shared world matrices (CPU), 16 eight-matrix material uniforms (GPU),
// bounded reference arrays and cached room transforms; no driver-program claim.
export const SUPPORT_CONTACT_RESERVE_BYTES=24*1024;
export function supportContactFits(used:number,limit:number){
  return used<=limit-SUPPORT_CONTACT_RESERVE_BYTES;
}

/** Stable admission may discard only expendable encoded cache entries. Leave a
 * modeled 1MiB working margin when reclaimable; keep all byte/pin guards and the
 * actual 24KiB contact gate. Mounted model reservations remain counted. */
export function reclaimSupportContactCache(input:{used:()=>number;limit:number;keys:Iterable<string>;evict:(key:string)=>unknown}){
  if(supportContactFits(input.used(),input.limit))return true;
  const target=input.limit-1024*1024;
  for(const key of input.keys){
    if(supportContactFits(input.used(),target))break;
    input.evict(key);
  }
  return supportContactFits(input.used(),input.limit);
}

export function supportContacts(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>,
  surfaces:ReadonlyMap<string,Three.Group>,rectangles:readonly (readonly Rectangle[])[],
  pedestals:ReadonlyMap<string,readonly Three.Object3D[]>,
  catalogBench?:{hostId:string;model:Three.Object3D},workspaceBenches?:ReadonlyMap<string,Three.Object3D>) {
  const contacts:SupportContact[]=[];
  const up=new three.Vector3(0,1,0),axisX=new three.Vector3(1,0,0);
  const floorRotation=new three.Quaternion().setFromAxisAngle(axisX,-Math.PI/2);
  const point=(value:readonly number[])=>new three.Vector3(value[0],value[1],value[2]);
  const wallDepths=new Map(wallFinishesFor(document).map(wall=>[wall.surfaceId.toLowerCase(),wall.depth]));
  const receiver=(roomId:string,type:'floor'|'wall')=>document.surfaces.flatMap((surface,index)=>{
    const group=surfaces.get(surface.id.toLowerCase());
    return surface.type===type&&surface.roomId.toLowerCase()===roomId.toLowerCase()&&group
      ?[{group,rectangles:rectangles[index]??[],faceZ:type==='wall'?(wallDepths.get(surface.id.toLowerCase())??0)/2:0}]:[];
  });
  function contains(receiver:Receiver,room:Three.Group,position:Three.Vector3,
    rotation:Three.Quaternion,width:number,height:number,tolerance=.008) {
    const corners=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>{
      const local=new three.Vector3(x!*width/2,y!*height/2,0).applyQuaternion(rotation).add(position);
      return receiver.group.worldToLocal(room.localToWorld(local));
    });
    return receiver.rectangles.some(rect=>corners.every(c=>Math.abs(c.z-receiver.faceZ)<tolerance&&
      Math.abs(c.x-rect.x)<rect.width/2-.002&&Math.abs(c.y-rect.y)<rect.height/2-.002));
  }
  function visibleLegBounds(leg:Three.Object3D,room:Three.Group) {
    let attached=false;
    for(let ancestor:Three.Object3D|null=leg;ancestor;ancestor=ancestor.parent){if(!ancestor.visible)return;if(ancestor===room)attached=true;}
    if(!attached)return;
    const result=new three.Box3();
    leg.traverseVisible(node=>{
      if(!(node instanceof three.Mesh))return;
      const vertices=node.geometry.getAttribute('position');
      if(!vertices?.count)return;
      const local=new three.Box3().setFromBufferAttribute(vertices);
      for(const x of [local.min.x,local.max.x])for(const y of [local.min.y,local.max.y])for(const z of [local.min.z,local.max.z])
        result.expandByPoint(room.worldToLocal(node.localToWorld(new three.Vector3(x,y,z))));
    });
    return result.isEmpty()?undefined:result;
  }
  const add=(room:Three.Group,position:Three.Vector3,rotation:Three.Quaternion,width:number,height:number,receiver:Three.Object3D,shape?:SupportContact['shape'],supports?:readonly Three.Object3D[])=>{
    contacts.push({room,receiver,position:position.toArray(),rotation:rotation.toArray(),width,height,...(shape?{shape}:{}),...(supports?{supports}:{})});
  };
  const addGroundRectangle=(room:Three.Group,floors:Receiver[],foot:RectangularGroundContact,supports?:readonly Three.Object3D[])=>{
    const center=point(foot.position),rotation=new three.Quaternion().fromArray(foot.rotation).multiply(floorRotation),feather=.035;
    const width=foot.width+2*feather,height=foot.depth+2*feather;
    // Prove physical support against the actual floor plane before adding the
    // existing 2mm shader offset. Keep the entire feather inside its rectangle.
    const floor=floors.find(floor=>contains(floor,room,center,rotation,foot.width,foot.depth,.004));
    if(!floor)return;
    center.y+=.002;
    if(contains(floor,room,center,rotation,width,height))
      add(room,center,rotation,width,height,floor.group,{kind:'rectangle',width:foot.width,height:foot.depth},supports);
  };

  for(const bench of benchesFor(document)){
    const room=rooms.get(bench.roomId.toLowerCase());
    if(!room)continue;
    const floor=receiver(bench.roomId,'floor');
    const yaw=new three.Quaternion().setFromAxisAngle(up,bench.yaw);
    const addFoot=(center:Three.Vector3,width:number,depth:number,plane:Three.Quaternion)=>{
      center.y+=.002;
      const surface=floor.find(surface=>contains(surface,room,center,plane,width,depth));
      if(surface)add(room,center,plane,width,depth,surface.group);
    };
    if(bench.workspaceVisual){
      // Replaced functional hosts do not describe the visible model's feet.
      // Use only mounted, visible geometry that actually reaches the floor.
      const model=workspaceBenches?.get(bench.workspaceVisual.placementId.toLowerCase());
      if(!model)continue;
      const base=visibleLegBounds(model,room);
      if(!base||Math.abs(base.min.y-bench.position[1])>.014)continue;
      const feet:{bounds:Three.Box3;meshes:Three.Mesh[]}[]=[];
      model.traverseVisible(node=>{
        if(!(node instanceof three.Mesh))return;
        const bounds=visibleLegBounds(node,room),size=bounds?.getSize(new three.Vector3());
        if(!bounds||!size||Math.abs(bounds.min.y-base.min.y)>.004||size.x>.25||size.z>.3)return;
        // Adjacent submeshes at one foot form one cue, avoiding stacked patches.
        const overlap=feet.find(foot=>foot.bounds.min.x<=bounds.max.x&&foot.bounds.max.x>=bounds.min.x&&foot.bounds.min.z<=bounds.max.z&&foot.bounds.max.z>=bounds.min.z);
        if(overlap){overlap.bounds.union(bounds);overlap.meshes.push(node);}else feet.push({bounds,meshes:[node]});
      });
      for(const foot of feet){
        const rectangle=rectangularGroundContact(three,foot.meshes,room,bench.position[1]);
        if(rectangle){addGroundRectangle(room,floor,rectangle,foot.meshes);continue;}
        const center=foot.bounds.getCenter(new three.Vector3()),size=foot.bounds.getSize(new three.Vector3());
        center.y=bench.position[1];
        addFoot(center,Math.min(.18,size.x+.07),Math.min(.18,size.z+.07),floorRotation);
      }
    }else if(catalogBench?.hostId.toLowerCase()===bench.id.toLowerCase()){ 
      const legs:Three.Object3D[]=[];
      const catalog=furnishingsFor(document),binding=catalog?.bindings.find(row=>row.hostKind==='bench'&&row.hostId.toLowerCase()===bench.id.toLowerCase());
      if(catalog?.assets.some(asset=>asset.id.toLowerCase()===binding?.assetId.toLowerCase()&&asset.catalogId==='sculpture-bench-refined')){
        // Discover the four actual small ground pads; never reuse the old model's node names.
        catalogBench.model.traverseVisible(node=>{if(!(node instanceof three.Mesh))return;const bounds=visibleLegBounds(node,room),size=bounds?.getSize(new three.Vector3());if(bounds&&size&&Math.abs(bounds.min.y-bench.position[1])<.002&&size.x<=.26&&size.z<=.31)legs.push(node);});
      }else for(const name of ['Leg','Leg001','Leg002','Leg003']){const leg=catalogBench.model.getObjectByName(name);if(leg)legs.push(leg);}
      for(const leg of legs){
        if(!leg)continue;
        const bounds=visibleLegBounds(leg,room);
        if(!bounds||Math.abs(bounds.min.y-bench.position[1])>.014)continue;
        const rectangle=rectangularGroundContact(three,[leg],room,bench.position[1]);
        if(rectangle){addGroundRectangle(room,floor,rectangle,[leg]);continue;}
        const center=bounds.getCenter(new three.Vector3());
        center.y=bench.position[1];
        const size=bounds.getSize(new three.Vector3());
        addFoot(center,Math.min(.18,size.x+.07),Math.min(.18,size.z+.07),floorRotation);
      }
    }else{
      for(const box of benchBoxes(bench,1,document)){
        if(Math.abs(box.position[1]-box.dimensions.height/2)>.001)continue;
        const center=point(box.position).applyQuaternion(yaw).add(point(bench.position));center.y=bench.position[1];
        addGroundRectangle(room,floor,{position:center.toArray(),rotation:yaw.toArray(),width:box.dimensions.width,depth:box.dimensions.depth});
      }
    }
  }

  for(const placement of document.placements){
    const room=rooms.get(placement.roomId.toLowerCase()),binding=installationFor(document,placement.id);
    const art=document.artworks.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase());
    if(!room||!binding||!art)continue;
    const pedestal=binding.pedestal;
    const visiblePedestals=pedestals.get(placement.id.toLowerCase())?.filter(mesh=>visibleLegBounds(mesh,room))??[];
    if(pedestal?.kind==='box'&&visiblePedestals.length){
      const yaw=new three.Quaternion().setFromAxisAngle(up,pedestal.yaw);
      const center=point(pedestal.position),top=center.y+pedestal.dimensions.height;
      const footprint=rectangularGroundContact(three,visiblePedestals,room,center.y);
      if(footprint)addGroundRectangle(room,receiver(placement.roomId,'floor'),footprint,visiblePedestals);
      const vertices=artifactCorners(art.dimensions,[art.transform,placement.transform]).map(value=>point(value).sub(center).applyQuaternion(yaw.clone().invert()));
      const bounds=new three.Box3().setFromPoints(vertices);
      if(Math.abs(bounds.min.y-pedestal.dimensions.height)<=.012){
        const x=Math.max(-pedestal.dimensions.width/2+.005,bounds.min.x-.025);
        const z=Math.max(-pedestal.dimensions.depth/2+.005,bounds.min.z-.025);
        const right=Math.min(pedestal.dimensions.width/2-.005,bounds.max.x+.025);
        const far=Math.min(pedestal.dimensions.depth/2-.005,bounds.max.z+.025);
        if(right>x&&far>z){
          const position=new three.Vector3((x+right)/2,0,(z+far)/2).applyQuaternion(yaw).add(center);
          position.y=top+.002;
          // A shallow support cue can complement the existing projected shadow.
          add(room,position,yaw.multiply(floorRotation),right-x,far-z,visiblePedestals[0]!);
        }
      }
    }

    const frame=binding.frame;
    if(!frame||frame.kind==='none'||art.artworkType!=='image')continue;
    const {corners,normal}=installationPlane(art,placement);
    const projection=receiver(placement.roomId,'wall').flatMap(wall=>{
      if(wall.group.scale.distanceTo(new three.Vector3(1,1,1))>.001)return [];
      const rotation=wall.group.quaternion;
      if(new three.Vector3(0,0,1).applyQuaternion(rotation).dot(point(normal))<.999)return [];
      const local=corners.map(value=>wall.group.worldToLocal(room.localToWorld(point(value))));
      const [a,b]=local;
      if(!a||!b||Math.abs(a.y-b.y)>.004||local.some(p=>p.z<frame.thickness||p.z>frame.thickness+.05))return [];
      const border=frame.gap+frame.matWidth+frame.borderWidth;
      // Architectural wall structures are centred on the metadata plane.
      // Shade their visible front face, rather than the buried centre plane.
      const position=point([(a.x+b.x)/2,a.y-border-.012,wall.faceZ+.002]).applyQuaternion(rotation).add(wall.group.position);
      const width=Math.abs(b.x-a.x)+2*border+.04,height=.075;
      return contains(wall,room,position,rotation,width,height)?[{position,rotation,width,height,receiver:wall.group}]:[];
    });
    if(projection.length===1){
      const {position,rotation,width,height,receiver}=projection[0]!;
      add(room,position,rotation,width,height,receiver);
    }
  }
  return contacts;
}
