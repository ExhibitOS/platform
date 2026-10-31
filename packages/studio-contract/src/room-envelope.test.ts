import {it,expect} from 'vitest';
import {newDraft} from '../../../apps/web/src/drafts/example';
import {whiteCubeSurfaces,newDoor} from '../../../apps/web/src/geometry/model';
import {newLight,newPlacement,syntheticArtwork,alignPlacement} from '../../../apps/web/src/placement/model';
import {LIGHT_DETAILS_NAMESPACE} from './light-details';
import {artifactPoint} from './artifact-affine';
import {resizeRoomEnvelope,completeRoomCeiling,setLightAttachment,lightAttachmentPose,validateLightAttachments,lightAttachmentsFor,remapLightAttachments,LIGHT_ATTACHMENT_NAMESPACE} from './room-envelope';
function roomDocument(){
 const doc=newDraft('Bounded room').candidate,room=doc.rooms[0]!;room.dimensions={width:8,height:3.2,depth:6};doc.surfaces=whiteCubeSurfaces(room);
 const light=newLight(room.id);light.transform.position=[0,3,0];doc.lights=[light];doc.extensions={[LIGHT_DETAILS_NAMESPACE]:{version:1,lights:[{lightId:light.id,fixture:'disc',aim:{kind:'rotation'}}]},'org.example/preserved':{version:1,value:'opaque'}};
 return doc;
}
it('resizes actual six surfaces and explicit ceiling light together, preserving floor objects, IDs and floor-relative door height',()=>{
 let doc=roomDocument();const room=doc.rooms[0]!,ceiling=doc.surfaces.find(s=>s.type==='ceiling')!,wall=doc.surfaces.find(s=>s.type==='wall')!;
 const door=newDoor(wall.id,{width:1,height:2.2},[0,-.5]);doc.openings.push(door);
 const art=syntheticArtwork(),p=newPlacement(art,room.id);p.transform.position=[1,.5,1];doc.artworks.push(art);doc.placements.push(p);
 const free=newLight(room.id);free.transform.position=[-1,.5,0];doc.lights.push(free);
 doc=setLightAttachment(doc,doc.lights[0]!.id,{surfaceId:ceiling.id,anchor:[0,0],gap:.2});
 const original=structuredClone(doc),next=resizeRoomEnvelope(doc,room.id,{width:10,height:4,depth:8});
 expect(doc).toEqual(original);expect(next.surfaces.map(s=>s.id)).toEqual(doc.surfaces.map(s=>s.id));
 expect(next.surfaces.find(s=>s.id===ceiling.id)).toMatchObject({dimensions:{width:10,height:8},transform:{position:[0,4,0]}});
 [0,3.8,0].forEach((v,i)=>expect(next.lights[0]!.transform.position[i]).toBeCloseTo(v));expect(next.lights[1]).toEqual(free);expect(next.placements).toEqual(doc.placements);
 const resizedWall=next.surfaces.find(s=>s.id===wall.id)!;expect(resizedWall.transform.position[1]+next.openings[0]!.offset[1]-door.dimensions.height/2).toBeCloseTo(0);
 expect(next.extensions?.['org.example/preserved']).toEqual(doc.extensions?.['org.example/preserved']);expect(validateLightAttachments(next).valid).toBe(true);
});
it('uses the owning room transform once for a yawed translated room and rejects implicit proximity attachments',()=>{
 let doc=roomDocument();const room=doc.rooms[0]!,q=Math.SQRT1_2;room.transform={position:[12,0,-5],rotation:[0,q,0,q],scale:[1,1,1]};
 const free=resizeRoomEnvelope(doc,room.id,{...room.dimensions,height:4});expect(free.lights[0]!.transform).toEqual(doc.lights[0]!.transform);expect(lightAttachmentsFor(free)).toEqual([]);
 const ceiling=doc.surfaces.find(s=>s.type==='ceiling')!;doc=setLightAttachment(doc,doc.lights[0]!.id,{surfaceId:ceiling.id,anchor:[1,1],gap:.2});
 const next=resizeRoomEnvelope(doc,room.id,{...room.dimensions,height:4}),point=artifactPoint(next.lights[0]!.transform.position,room.transform);
 expect(point[0]).toBeCloseTo(13);expect(point[1]).toBeCloseTo(3.8);expect(point[2]).toBeCloseTo(-6);
});
it('adds a real missing ceiling idempotently and rejects duplicate or noncanonical outer envelopes without replacing source',()=>{
 const doc=roomDocument(),room=doc.rooms[0]!;doc.surfaces=doc.surfaces.filter(s=>s.type!=='ceiling');const original=structuredClone(doc);
 expect(()=>resizeRoomEnvelope(doc,room.id,room.dimensions)).toThrow(/네 벽/);
 const complete=completeRoomCeiling(doc,room.id);expect(doc).toEqual(original);expect(complete.surfaces.filter(s=>s.type==='ceiling')).toHaveLength(1);expect(completeRoomCeiling(complete,room.id)).toEqual(complete);
 const duplicate=structuredClone(complete);duplicate.surfaces.push({...structuredClone(duplicate.surfaces[0]!),id:crypto.randomUUID()});expect(()=>resizeRoomEnvelope(duplicate,room.id,room.dimensions)).toThrow(/겹쳐/);
 const partial=structuredClone(complete);partial.surfaces[0]!.dimensions.width-=1;expect(()=>resizeRoomEnvelope(partial,room.id,room.dimensions)).toThrow(/네 벽/);
});
it('rejects a moved aligned wall artwork and full affine shrink instead of inferring a new attachment',()=>{
 const doc=roomDocument(),room=doc.rooms[0]!,art=syntheticArtwork('image');doc.artworks.push(art);
 doc.placements.push(alignPlacement(doc,newPlacement(art,room.id),doc.surfaces[0]!,[1,0],0));const original=structuredClone(doc);
 expect(()=>resizeRoomEnvelope(doc,room.id,{...room.dimensions,depth:8})).toThrow(/작품이 떨어져/);expect(doc).toEqual(original);
 const tilted=roomDocument(),image=syntheticArtwork('image');image.transform.rotation=[Math.sin(Math.PI/12),0,0,Math.cos(Math.PI/12)];tilted.artworks.push(image);tilted.placements.push(alignPlacement(tilted,newPlacement(image,tilted.rooms[0]!.id),tilted.surfaces[0]!,[0,0],0));expect(()=>resizeRoomEnvelope(tilted,tilted.rooms[0]!.id,{...tilted.rooms[0]!.dimensions,depth:8})).toThrow(/작품이 떨어져/);
 const affine=roomDocument(),a=syntheticArtwork(),p=newPlacement(a,affine.rooms[0]!.id);p.transform.position=[2.7,1,0];p.transform.scale=[2,1,1];p.transform.rotation=[0,Math.sin(Math.PI/8),0,Math.cos(Math.PI/8)];affine.artworks.push(a);affine.placements.push(p);
 expect(()=>resizeRoomEnvelope(affine,affine.rooms[0]!.id,{width:5,height:4,depth:8})).toThrow(/작품 전체/);
});
it('preserves a paired doorway on a height change and rejects moving its connected wall alone',()=>{
 const doc=roomDocument(),r=doc.rooms[0]!,second={...structuredClone(r),id:crypto.randomUUID(),name:'Neighbor',transform:{...structuredClone(r.transform),position:[8,0,0] as [number,number,number]}};doc.rooms.push(second);const other=whiteCubeSurfaces(second);doc.surfaces.push(...other);
 const left=newDoor(doc.surfaces[3]!.id,{width:1,height:2.2},[0,-.5]),right=newDoor(other[2]!.id,{width:1,height:2.2},[0,-.5]);left.connectsToOpeningId=right.id;right.connectsToOpeningId=left.id;delete left.exterior;delete right.exterior;doc.openings=[left,right];
 expect(()=>resizeRoomEnvelope(doc,r.id,{...r.dimensions,height:4})).not.toThrow();
 expect(()=>resizeRoomEnvelope(doc,r.id,{...r.dimensions,width:10})).toThrow(/두 문/);
});
it('requires explicit closed attachment identity, preserves pose on detach, and checks whole fixture bounds',()=>{
 const doc=roomDocument(),light=doc.lights[0]!,ceiling=doc.surfaces.find(s=>s.type==='ceiling')!;
 expect(()=>setLightAttachment(doc,light.id,{surfaceId:ceiling.id,anchor:[0,0],gap:.01})).toThrow(/기구 전체/);
 expect(()=>setLightAttachment(doc,light.id,{surfaceId:ceiling.id,anchor:[3.99,0],gap:.2})).toThrow(/기구 전체/);
 const attached=setLightAttachment(doc,light.id,{surfaceId:ceiling.id,anchor:[0,0],gap:.2}),detached=setLightAttachment(attached,light.id,null);expect(detached.lights).toEqual(attached.lights);expect(lightAttachmentsFor(detached)).toEqual([]);
 const corrupt=structuredClone(attached);corrupt.lights[0]!.transform.position[1]-=.1;expect(validateLightAttachments(corrupt).valid).toBe(false);
 const binding=lightAttachmentsFor(attached)[0]!;expect(lightAttachmentPose(ceiling,binding)).toEqual(attached.lights[0]!.transform);
 const ids=new Map([[light.id.toLowerCase(),crypto.randomUUID()],[ceiling.id.toLowerCase(),crypto.randomUUID()]]),mapped=remapLightAttachments({version:1,lights:[binding]},ids);expect(mapped.lights[0]).toMatchObject({lightId:ids.get(light.id),surfaceId:ids.get(ceiling.id)});expect(()=>remapLightAttachments({version:1,lights:[binding]},new Map())).toThrow('LIGHT_ATTACHMENT_REFERENCE');expect(()=>remapLightAttachments({version:1,lights:[binding]},new Map([[light.id,'not-a-uuid']]))).toThrow('LIGHT_ATTACHMENT_REFERENCE');
 (attached.extensions![LIGHT_ATTACHMENT_NAMESPACE] as unknown as {extra?:boolean}).extra=true;expect(validateLightAttachments(attached).valid).toBe(false);
});
