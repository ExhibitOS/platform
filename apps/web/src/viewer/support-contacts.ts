// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {artifactCorners,benchBoxes,benchesFor,installationFor,installationPlane,wallFinishesFor} from '@exhibitos/studio-contract';
import type {SupportContact} from './shadows';

type Rectangle = {x:number;y:number;width:number;height:number};
type Receiver = {group:Three.Group;rectangles:readonly Rectangle[];faceZ:number};

// Bounded contact descriptors and matrix/uniform state; compiled-program
// storage is driver-owned and is not represented by this byte estimate.
const SUPPORT_CONTACT_BYTES=12*1024;
export function supportContactFits(used:number,limit:number){
  return used<=limit-SUPPORT_CONTACT_BYTES;
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
    rotation:Three.Quaternion,width:number,height:number) {
    const corners=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>{
      const local=new three.Vector3(x!*width/2,y!*height/2,0).applyQuaternion(rotation).add(position);
      return receiver.group.worldToLocal(room.localToWorld(local));
    });
    return receiver.rectangles.some(rect=>corners.every(c=>Math.abs(c.z-receiver.faceZ)<.008&&
      Math.abs(c.x-rect.x)<rect.width/2-.002&&Math.abs(c.y-rect.y)<rect.height/2-.002));
  }
  function visibleLegBounds(leg:Three.Object3D,room:Three.Group) {
    for(let ancestor:Three.Object3D|null=leg;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return;
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
  const add=(room:Three.Group,position:Three.Vector3,rotation:Three.Quaternion,width:number,height:number,receiver:Three.Object3D)=>{
    contacts.push({room,receiver,position:position.toArray(),rotation:rotation.toArray(),width,height});
  };

  for(const bench of benchesFor(document)){
    const room=rooms.get(bench.roomId.toLowerCase());
    if(!room)continue;
    const floor=receiver(bench.roomId,'floor');
    const yaw=new three.Quaternion().setFromAxisAngle(up,bench.yaw);
    const rotation=yaw.clone().multiply(floorRotation);
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
      const feet:Three.Box3[]=[];
      model.traverseVisible(node=>{
        if(!(node instanceof three.Mesh))return;
        const bounds=visibleLegBounds(node,room),size=bounds?.getSize(new three.Vector3());
        if(!bounds||!size||Math.abs(bounds.min.y-base.min.y)>.004||size.x>.25||size.z>.3)return;
        // Adjacent submeshes at one foot form one cue, avoiding stacked patches.
        const overlap=feet.find(box=>box.min.x<=bounds.max.x&&box.max.x>=bounds.min.x&&box.min.z<=bounds.max.z&&box.max.z>=bounds.min.z);
        if(overlap)overlap.union(bounds);else feet.push(bounds);
      });
      for(const foot of feet){
        const center=foot.getCenter(new three.Vector3()),size=foot.getSize(new three.Vector3());
        center.y=bench.position[1];
        addFoot(center,Math.min(.18,size.x+.07),Math.min(.18,size.z+.07),floorRotation);
      }
    }else if(catalogBench?.hostId.toLowerCase()===bench.id.toLowerCase()){ 
      for(const name of ['Leg','Leg001','Leg002','Leg003']){
        const leg=catalogBench.model.getObjectByName(name);
        if(!leg)continue;
        const bounds=visibleLegBounds(leg,room);
        if(!bounds||Math.abs(bounds.min.y-bench.position[1])>.014)continue;
        const center=bounds.getCenter(new three.Vector3());
        center.y=bench.position[1];
        const size=bounds.getSize(new three.Vector3());
        addFoot(center,Math.min(.18,size.x+.07),Math.min(.18,size.z+.07),floorRotation);
      }
    }else{
      for(const box of benchBoxes(bench)){
        if(Math.abs(box.position[1]-box.dimensions.height/2)>.001)continue;
        const center=point(box.position).applyQuaternion(yaw).add(point(bench.position));
        center.y=bench.position[1];
        addFoot(center,box.dimensions.width+.07,box.dimensions.depth+.07,rotation);
      }
    }
  }

  for(const placement of document.placements){
    const room=rooms.get(placement.roomId.toLowerCase()),binding=installationFor(document,placement.id);
    const art=document.artworks.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase());
    if(!room||!binding||!art)continue;
    const pedestal=binding.pedestal;
    if(pedestal?.kind==='box'&&pedestals.get(placement.id.toLowerCase())?.some(mesh=>mesh.visible)){
      const yaw=new three.Quaternion().setFromAxisAngle(up,pedestal.yaw);
      const center=point(pedestal.position),top=center.y+pedestal.dimensions.height;
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
          add(room,position,yaw.multiply(floorRotation),right-x,far-z,pedestals.get(placement.id.toLowerCase())!.find(mesh=>mesh.visible)!);
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
