// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import * as three from 'three';
import {setLightDetails,resolveTrackSpotAiming} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {newLight} from './placement/model';
import {installLightDetails,installLightFixtureGate} from './light-details-renderer';
import {fixtureAdmittedIndirectRooms} from './viewer/room-indirect';
import {articulatedTrackFixture} from './private-editor/articulated-track.test-fixture';
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
test('procedural lenses follow their own live light while bodies and illumination remain unchanged',()=>{
 const h=fixture(),second=structuredClone(h.document.lights[0]!);second.id=crypto.randomUUID();h.document.lights.push(second);
 const {id,...fields}=second,document=setLightDetails(h.document,id,fields,{fixture:'spot-can'}),other=new three.SpotLight(0xff0000,1);h.room.add(other);h.lights.set(id,{light:other});
 const owner=installLightDetails(three,document,h.rooms,h.lights,false),firstGroup=owner.fixtures.get(h.document.lights[0]!.id.toLowerCase())![0]!,secondGroup=owner.fixtures.get(id.toLowerCase())![0]!,lens=firstGroup.children[1] as three.Mesh,otherLens=secondGroup.children[1] as three.Mesh,material=lens.material as three.MeshStandardMaterial,otherMaterial=otherLens.material as three.MeshStandardMaterial;
 expect(material).not.toBe(otherMaterial);expect(firstGroup.children[0] instanceof three.Mesh).toBe(true);expect((firstGroup.children[0] as three.Mesh).material).toBe((secondGroup.children[0] as three.Mesh).material);
 expect(material.emissive.toArray()).toEqual(h.spot.color.toArray());expect(otherMaterial.emissiveIntensity).toBe(.5);
 const illumination=h.spot.toJSON(),body=((firstGroup.children[0] as three.Mesh).material as three.MeshStandardMaterial).toJSON();h.spot.intensity=0;
 lens.onBeforeRender({} as three.WebGLRenderer,{} as three.Scene,{} as three.Camera,lens.geometry,material,null as unknown as three.Group);
 expect(material.emissive.toArray()).toEqual([0,0,0]);expect(otherMaterial.emissiveIntensity).toBe(.5);expect(((firstGroup.children[0] as three.Mesh).material as three.MeshStandardMaterial).toJSON()).toEqual(body);
 h.spot.intensity=document.lights[0]!.intensity;expect(h.spot.toJSON()).toEqual(illumination);expect(h.room.children.filter(o=>o instanceof three.Light)).toHaveLength(2);owner.dispose();
});

test('known articulated optics use the Shared emitter and exact target and restore stale base optics on disposal',()=>{
 const {document,binding,lightId}=articulatedTrackFixture(),before=structuredClone(document),room=new three.Group(),spot=new three.SpotLight();
 spot.position.set(4,2,3);spot.quaternion.setFromAxisAngle(new three.Vector3(0,1,0),.4);room.add(spot);
 const originalPosition=spot.position.clone(),originalQuaternion=spot.quaternion.clone(),originalTarget=spot.target;
 const rooms=new Map([[document.rooms[0]!.id.toLowerCase(),room]]),lights=new Map([[lightId,{light:spot}]]),result=resolveTrackSpotAiming(document,lightId);
 if(!result.reachable)throw Error(result.reason);
 const owner=installLightDetails(three,document,rooms,lights,false);
 expect(spot.position.toArray()).toEqual(result.emitter);expect(spot.target.position.toArray()).toEqual(result.resolvedTarget);
 expect(owner.records[0]).toMatchObject({fixtureMeshes:0,guideCount:0,range:7,penumbra:.35});
 expect(document).toEqual(before);owner.dispose();owner.dispose();
 expect(spot.position).toEqual(originalPosition);expect(spot.quaternion.toArray()).toEqual(originalQuaternion.toArray());expect(spot.target).toBe(originalTarget);expect(room.children).toEqual([spot]);
 binding.aim={kind:'point',position:[-.8,1.5,-1.2]};
 const moved=resolveTrackSpotAiming(document,lightId);if(!moved.reachable)throw Error(moved.reason);
 const next=installLightDetails(three,document,rooms,lights,true);
 expect(moved.fixedPose).toEqual(result.fixedPose);expect(spot.position.toArray()).toEqual(moved.emitter);expect(spot.position.toArray()).not.toEqual(result.emitter);
 expect(next.records[0]!.guideCount).toBe(1);next.dispose();expect(spot.position).toEqual(originalPosition);
});

test('manual joint optics keep their resolved ray and invalid known intent never mutates live lights',()=>{
 const {document,binding,lightId}=articulatedTrackFixture(),room=new three.Group(),spot=new three.SpotLight();spot.position.set(2,3,4);room.add(spot);
 const rooms=new Map([[document.rooms[0]!.id.toLowerCase(),room]]),lights=new Map([[lightId,{light:spot}]]);
 binding.aim={kind:'manual',yaw:.2,pitch:-.8};const result=resolveTrackSpotAiming(document,lightId);if(!result.reachable)throw Error(result.reason);
 const owner=installLightDetails(three,document,rooms,lights,false);
 const ray=spot.target.position.clone().sub(spot.position).normalize();result.direction.forEach((n,i)=>expect(ray.getComponent(i)).toBeCloseTo(n,12));owner.dispose();
 const position=spot.position.clone(),target=spot.target,children=[...room.children];
 binding.aim={kind:'point',position:[-1,4,-1.2]};
 expect(()=>installLightDetails(three,document,rooms,lights,false)).toThrow();
 expect(spot.position).toEqual(position);expect(spot.target).toBe(target);expect(room.children).toEqual(children);
});


test('only the default area and physically supported luminaires are eligible to emit',()=>{
 const h=fixture(),builtIn=installLightDetails(three,h.document,h.rooms,h.lights,false);
 const roomId=h.document.rooms[0]!.id;
 const lights=new Map<string,{light:three.Light}>(h.lights);
 const add=(type:'area'|'spot'|'point',light:three.Light,targetRoom=roomId)=>{
  const item=newLight(targetRoom,type);
  h.document.lights.push(item);h.room.add(light);lights.set(item.id,{light});return item.id;
 };
 const base=add('area',new three.RectAreaLight()),supplemental=add('area',new three.RectAreaLight());
 const legacyRoom={...structuredClone(h.document.rooms[0]!),id:crypto.randomUUID()};
 h.document.rooms.push(legacyRoom);
 const point=add('point',new three.PointLight(),legacyRoom.id),railOnly=add('spot',new three.SpotLight());
 const track=add('spot',new three.SpotLight()),bad=add('spot',new three.SpotLight());
 const details=h.document.extensions!['org.exhibitos.studio/light-details'] as {lights:{lightId:string;fixture:string;purpose?:string}[]};
 details.lights.push({lightId:base,fixture:'none',purpose:'room-base'},{lightId:supplemental,fixture:'none',purpose:'room-supplemental-fill'},{lightId:point,fixture:'none',purpose:'room-base'});
 const bindings=[track,bad].map(hostId=>({hostKind:'light',hostId}));
 h.document.extensions!['org.exhibitos.studio/furnishing-visuals']={version:1,assets:[],bindings:[...bindings,null,{hostKind:'light',hostId:42}]};
 const gate=installLightFixtureGate(h.document,lights,builtIn.fixtures,new Set([track]),true);
 const report=(id:string)=>gate.records().find(item=>item.lightId===id);
 try{
  expect(report(base)).toMatchObject({eligible:true,support:'room-base-area'});
  const admittedRoom={roomId,emitterIds:[base],scale:1,charts:[]};
  const disabledRoom={...admittedRoom,emitterIds:[base,supplemental]};
  expect(fixtureAdmittedIndirectRooms([admittedRoom,disabledRoom],gate.records())).toEqual([admittedRoom]);
  for(const id of [supplemental,point,railOnly])expect(report(id)).toMatchObject({eligible:false,reason:'absent'});
  expect(report(bad)).toMatchObject({eligible:false,reason:'invalid'});
  expect(report(track)).toMatchObject({eligible:false,reason:'pending'});
  expect(report(h.document.lights[0]!.id)).toMatchObject({eligible:true,support:'built-in'});
  // No camera or rendered-frame event is needed to retain fixture eligibility.
  gate.settle(track,'ready');
  expect(lights.get(track)?.light.visible).toBe(true);
  expect(report(track)).toMatchObject({eligible:true,support:'catalogue'});
  gate.settle(track,'model-failed');
  expect(lights.get(track)?.light.visible).toBe(false);
  expect(report(track)).toMatchObject({eligible:false,reason:'model-failed'});
 }finally{builtIn.dispose();}
});
