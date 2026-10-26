// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import * as three from 'three';
import {setLightDetails} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {newLight} from './placement/model';
import {installLightDetails} from './light-details-renderer';
function fixture(){
  const d=newDraft().candidate,l=newLight(d.rooms[0]!.id,'spot');l.transform.position=[0,2.4,1];l.color=[.2,.3,.4];d.lights=[l];const {id,...light}=l;
  const document=setLightDetails(d,id,light,{fixture:'spot-can',aim:{kind:'point',position:[0,1,0]},penumbra:.4,range:7}),room=new three.Group(),spot=new three.SpotLight(new three.Color().setRGB(...l.color),l.intensity);spot.position.fromArray(l.transform.position);room.add(spot);const rooms=new Map([[l.roomId.toLowerCase(),room]]),lights=new Map([[id,{light:spot}]]);return {document,room,spot,rooms,lights};
}
test('light details create bounded public fixture bodies and actual beam settings without K repaint or authoring guides; disposal restores source',()=>{
  const h=fixture(),target=h.spot.target,color=h.spot.color.toArray(),quaternion=h.spot.quaternion.clone(),owner=installLightDetails(three,h.document,h.rooms,h.lights,false);
  expect(owner.records[0]).toMatchObject({fixtureMeshes:2,guideCount:0,target:[0,1,0],penumbra:.4,range:7,color});expect(h.spot.target.position.toArray()).toEqual([0,1,0]);const meshes:three.Mesh[]=[];h.room.traverse(o=>{if(o instanceof three.Mesh)meshes.push(o);});expect(meshes).toHaveLength(2);expect(meshes.every(m=>m.userData.exhibitosLightFixture&&!m.castShadow)).toBe(true);expect(h.spot.color.toArray()).toEqual(color);
  owner.dispose();owner.dispose();expect(h.spot.target).toBe(target);expect(h.spot.distance).toBe(0);expect(h.spot.penumbra).toBe(0);expect(h.spot.quaternion.toArray()).toEqual(quaternion.toArray());expect(h.room.children).toEqual([h.spot]);
});
test('light details authoring guides exist only for an editor and legacy absence changes no light or room',()=>{
  const h=fixture(),owner=installLightDetails(three,h.document,h.rooms,h.lights,true);expect(owner.records[0]!.guideCount).toBe(1);owner.dispose();
  delete h.document.extensions!['org.exhibitos.studio/light-details'];const before=[...h.room.children],legacy=installLightDetails(three,h.document,h.rooms,h.lights,true);expect(legacy.records).toEqual([]);expect(h.room.children).toEqual(before);expect(h.spot.distance).toBe(0);legacy.dispose();
});
