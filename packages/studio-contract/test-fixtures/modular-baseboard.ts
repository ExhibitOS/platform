// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic metadata only: no model bytes, user assets or source authorizations.
import {newDraft} from '../../../apps/web/src/drafts/example.js';
import {whiteCubeSurfaces,newDoor} from '../../../apps/web/src/geometry/model.js';
import type {Exhibition} from '@exhibitos/spec';
import type {WallFinish} from '../src/architectural-finishes.js';
import type {WorkspaceFurnishings} from '../src/workspace-furnishing.js';
import type {WorkspaceFitGeometry} from '../src/workspace-fit-receipt.js';
export function modularBaseboardFixture(paired=false){
 const document=newDraft('Synthetic baseboard').candidate,room=document.rooms[0]!,surfaces=whiteCubeSurfaces(room),wall=surfaces[0]!,size=paired?{width:2.4,height:3}:{width:1.4,height:2.6},opening=newDoor(wall.id,size,[.7,size.height/2-room.dimensions.height/2]);
 document.surfaces=surfaces;document.openings=[opening];document.lights=[];
 const settings:WallFinish={surfaceId:wall.id,depth:.12,preset:'plain',trimWidth:.02,baseboardHeight:.04,ceilingBand:false},walls:WallFinish[]=[settings];
 if(paired){
  const other={...structuredClone(room),id:crypto.randomUUID(),transform:{...structuredClone(room.transform),position:[0,0,-room.dimensions.depth-.02] as [number,number,number]}};
  document.rooms.push(other);const peer=whiteCubeSurfaces(other)[1]!,mate=newDoor(peer.id,size,[-.7,size.height/2-room.dimensions.height/2]);
  opening.connectsToOpeningId=mate.id;mate.connectsToOpeningId=opening.id;document.surfaces.push(peer);document.openings.push(mate);walls.push({...settings,surfaceId:peer.id,preset:'painted-edge'});
 }
 document.extensions={...document.extensions,'org.exhibitos.studio/architectural-finishes':{version:1,walls} as unknown as NonNullable<Exhibition['extensions']>[string]};
 const parts:Record<string,{node:number;min:[number,number,number];max:[number,number,number]}>={};let node=0;
 for(const face of ['reveal','front','back'])for(const side of ['left','right','head']){
  const trim=face==='reveal'?.025:.04,x=side==='left'?[-1.2-trim,-1.2]:side==='right'?[1.2,1.2+trim]:[-1.2-trim,1.2+trim],y=side==='head'?[2.6,2.6+trim]:[0,2.6],z=face==='front'?[.1,.106]:face==='back'?[-.106,-.1]:[-.1,.1];
  parts[`${face}-${side}`]={node:node++,min:[x[0]!,y[0]!,z[0]!],max:[x[1]!,y[1]!,z[1]!]};
 }
 const model={mime:'model/gltf-binary' as const,bytes:100,sha256:'a'.repeat(64)},id=crypto.randomUUID(),geometry={profile:'modular-portal-v1',openingWidth:2.4,openingHeight:2.6,minZ:-.1,maxZ:.1,parts} as WorkspaceFitGeometry;
 const workspace:WorkspaceFurnishings={version:7,furnishings:[{id,version:1,kind:'portal-finish',name:'Synthetic modular portal',provenance:'Synthetic metadata fixture',rights:{holder:'Synthetic fixture',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,export:true,download:true,commercial:true}},model,fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry}}],placements:[],frameAttachments:[],openingAttachments:[{openingId:opening.id,furnishingId:id,furnishingVersion:1,modelSha256:model.sha256}]};
 document.extensions['org.exhibitos.studio/workspace-furnishings']=workspace as unknown as NonNullable<Exhibition['extensions']>[string];
 return {document,room,wall,opening,settings,workspace};
}
