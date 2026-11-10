// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,PerspectiveCamera,Scene,type WebGLRenderer} from 'three';
import {newDraft} from './drafts/example';
import {newLight} from './placement/model';
import {checkedCatalogDropRequest,type CatalogDropRequest} from './native-catalog-drop';
import {installNativePlacementPreview} from './native-placement-renderer';
import type {NativePlacement} from './native-placement';
import type {NativeViewportFrame} from './native-viewport-protocol';

function fixture(){
 const draft=newDraft(),room=draft.candidate.rooms[0]!,light=newLight(room.id);
 draft.candidate.lights=[{...light,type:'spot'}];
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),
  principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:false,disabled:false};
 const {version,epoch,sequence,tenantId,principalId}=frame;
 const request={version,epoch,sequence,tenantId,principalId,requestId:crypto.randomUUID(),
  targetKind:'light',phase:'hover',point:{x:.5,y:.5}} satisfies CatalogDropRequest;
 return {frame,request,light};
}

test('drop requests reject stale scope, invalid points and extra pose data',()=>{
 const {frame,request}=fixture();
 expect(checkedCatalogDropRequest(request,frame)).toEqual(request);
 expect(()=>checkedCatalogDropRequest({...request,sequence:0},frame)).toThrow();
 expect(()=>checkedCatalogDropRequest({...request,point:{x:NaN,y:.5}},frame)).toThrow();
 expect(()=>checkedCatalogDropRequest({...request,position:[0,0,0]},frame)).toThrow();
 expect(()=>checkedCatalogDropRequest(request,{...frame,presentation:'plan'})).toThrow();
 const {point,...binding}=request;
 expect(checkedCatalogDropRequest({...binding,phase:'clear'},frame)).toMatchObject({phase:'clear'});
 expect(checkedCatalogDropRequest({...binding,phase:'clear'},{...frame,disabled:true})).toMatchObject({phase:'clear'});
 expect(()=>checkedCatalogDropRequest({...binding,phase:'clear',point},frame)).toThrow();
});

test('fixture picking highlights only the nearest visible compatible light and clears on exit',()=>{
 const {frame,request,light}=fixture();
 const scene=new Scene(),model=new Group(),camera=new PerspectiveCamera(50,1,.1,20);
 scene.add(model);camera.position.z=5;
 const geometry=new BoxGeometry(),material=new MeshBasicMaterial();
 const fixtureMesh=new Mesh(geometry,material),occluder=new Mesh(geometry,material);
 fixtureMesh.userData={exhibitosLightFixture:true,lightId:light.id};
 occluder.position.z=2;model.add(fixtureMesh,occluder);
 const renderer={domElement:new EventTarget()} as unknown as WebGLRenderer;
 const placement={snapshot:()=>null,cancel:()=>{}} as unknown as NativePlacement;
 vi.stubGlobal('window',new EventTarget());
 const preview=installNativePlacementPreview(placement,{scene,model,camera,renderer,document:frame.draft.candidate,
  rooms:new Map(),surfaces:new Map(),frameReady:()=>true,load:async()=>{throw Error('unexpected load');},render:()=>{}});
 try{
  expect(preview.catalogDrop(request)).toBeNull();
  occluder.visible=false;
  expect(preview.catalogDrop(request)).toEqual({kind:'light',lightId:light.id});
  expect(scene.children.some(node=>node.type==='BoxHelper')).toBe(true);
  const {version,requestId,epoch,sequence,tenantId,principalId,targetKind}=request;
  expect(preview.catalogDrop({version,requestId,epoch,sequence,tenantId,principalId,targetKind,phase:'clear'})).toBeNull();
  expect(scene.children.some(node=>node.type==='BoxHelper')).toBe(false);
  expect(preview.catalogDrop(request)).toEqual({kind:'light',lightId:light.id});
  window.dispatchEvent(new Event('blur'));
  expect(scene.children.some(node=>node.type==='BoxHelper')).toBe(false);
  expect(preview.catalogDrop(request)).toEqual({kind:'light',lightId:light.id});
  renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
  expect(scene.children.some(node=>node.type==='BoxHelper')).toBe(false);
  fixtureMesh.visible=false;
  expect(preview.catalogDrop({...request,phase:'drop'})).toBeNull();
 }finally{preview.dispose();geometry.dispose();material.dispose();vi.unstubAllGlobals();}
});
