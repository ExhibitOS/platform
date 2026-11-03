// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {newDraft} from './drafts/example';
import {syntheticArtwork,newPlacement} from './placement/model';
import {checkedInspectionCamera,inspectionCameraPose} from './scene-snapshot-camera';

function fixture(){
 const document=newDraft().candidate,room=document.rooms[0]!;room.dimensions={width:10,height:4,depth:10};room.transform={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
 const art=syntheticArtwork('image'),placement=newPlacement(art,room.id);document.artworks=[art];document.placements=[placement];
 return {document,room,placement,camera:{roomId:room.id,position:[0,1.5,-2.4] as [number,number,number],target:[0,1.5,-4.94] as [number,number,number],fov:50}};
}
test('an inspection pose needs no stored viewpoint and leaves the approved document/input intact',()=>{
 const s=fixture(),before=structuredClone(s);expect(checkedInspectionCamera(s.camera,s.document,s.placement.id)).toEqual(s.camera);
 expect(inspectionCameraPose(s.document,s.placement.id,s.camera)).toEqual({inspection:true,...s.camera,localPosition:s.camera.position,localTarget:s.camera.target});expect(s).toEqual(before);
});
test('uses the full rotated and scaled room affine with independent numeric goldens',()=>{
 const s=fixture();s.room.transform={position:[10,0,-7],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2],scale:[2,3,4]};
 const result=inspectionCameraPose(s.document,s.placement.id,{...s.camera,position:[1,1,2],target:[0,1,0]});
 result.position.forEach((v,i)=>expect(v).toBeCloseTo([7,2,1][i]!,10));result.target.forEach((v,i)=>expect(v).toBeCloseTo([7,0,-7][i]!,10));
});
test('refuses foreign/missing targets, extra fields, nonfinite lenses and out-of-room points',()=>{
 const s=fixture();for(const camera of [{...s.camera,roomId:crypto.randomUUID()},{...s.camera,url:'https://example.org/'},{...s.camera,fov:NaN},{...s.camera,fov:9},{...s.camera,fov:121},{...s.camera,position:[0,-.01,0]},{...s.camera,target:[0,1,-5.01]},{...s.camera,position:[Infinity,1,0]},{...s.camera,position:s.camera.target}])expect(()=>checkedInspectionCamera(camera,s.document,s.placement.id)).toThrow('SCENE_SNAPSHOT_CAMERA_INVALID');
 expect(()=>checkedInspectionCamera(s.camera,s.document,crypto.randomUUID())).toThrow('SCENE_SNAPSHOT_CAMERA_INVALID');
 const room={...structuredClone(s.room),id:crypto.randomUUID()};s.document.rooms.push(room);expect(()=>checkedInspectionCamera({...s.camera,roomId:room.id},s.document,s.placement.id)).toThrow('SCENE_SNAPSHOT_CAMERA_INVALID');
});
