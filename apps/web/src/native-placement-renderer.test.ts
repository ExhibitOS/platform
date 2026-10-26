// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {Group,Matrix4,Mesh,MeshBasicMaterial,PerspectiveCamera,PlaneGeometry,Quaternion,Scene,Vector3} from 'three';
import type {WebGLRenderer} from 'three';
import type {Artwork} from '@exhibitos/spec';
import {syntheticArtwork} from './placement/model';
import type {NativePlacement,NativePlacementIntent} from './native-placement';
import {installNativePlacementPreview} from './native-placement-renderer';
afterEach(()=>vi.unstubAllGlobals());
function setup(pending=false){
 const host=new EventTarget();vi.stubGlobal('window',host);
 const canvas=Object.assign(new EventTarget(),{getBoundingClientRect:()=>({left:0,top:0,width:200,height:200})});
 const scene=new Scene(),model=new Group(),room=new Group(),surface=new Group();scene.add(model);model.add(room);room.add(surface);
 surface.userData.editorSelection={kind:'surface',id:'wall'};surface.add(new Mesh(new PlaneGeometry(4,4),new MeshBasicMaterial()));
 const camera=new PerspectiveCamera(50,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 const artwork=syntheticArtwork('image'),material=new MeshBasicMaterial(),object=new Mesh(new PlaneGeometry(1,1),material),release=vi.fn();
 let intent={request:{roomId:'room'},artwork,target:null,committing:false} as unknown as NativePlacementIntent;
 const choose=vi.fn(),cancel=vi.fn(()=>{intent=null!;});
 const placement={get active(){return !!intent;},snapshot:()=>intent,choose,cancel} as unknown as NativePlacement;
 const asset={object,release};let resolve!:(value:typeof asset)=>void;
 const load=vi.fn((_artwork:Artwork,_signal:AbortSignal)=>pending?new Promise<typeof asset>(r=>{resolve=r;}):Promise.resolve(asset));
 const preview=installNativePlacementPreview(placement,{scene,model,camera,renderer:{domElement:canvas} as unknown as WebGLRenderer,rooms:new Map([['room',room]]),surfaces:new Map([['wall',surface]]),load,render:vi.fn()});
 const event=(type:string,x=100,y=100,extra={})=>{const e=Object.assign(new Event(type,{cancelable:true}),{button:0,pointerId:1,isPrimary:true,clientX:x,clientY:y,...extra});canvas.dispatchEvent(e);return e;};
 const click=(x=100,y=100)=>{event('pointerdown',x,y);event('pointerup',x,y);event('click',x,y);};
 return {preview,scene,model,room,host,canvas,material,load,release,choose,cancel,event,click,resolve:()=>resolve(asset),target:(rotation=[0,0,0,1])=>{intent.target={placement:{transform:{position:[0,0,0],rotation,scale:[1,1,1]}}} as unknown as NativePlacementIntent['target'];preview.sync();},clear:()=>{intent=null!;preview.sync();}};
}
it('a primary click returns the nearest real surface coordinate and consumes ordinary selection; a drag does not choose',()=>{
 const s=setup(),ordinary=vi.fn();s.canvas.addEventListener('click',ordinary);s.click();
 expect(s.choose).toHaveBeenCalledWith('wall',[0,0]);expect(ordinary).not.toHaveBeenCalled();
 s.choose.mockClear();s.event('pointerdown',80,100);s.event('pointerup',100,100);s.event('click',100,100);expect(s.choose).not.toHaveBeenCalled();s.preview.dispose();
});
it('a nearer artwork blocks picking through it to a wall, while dimension lines do not substitute for a surface',()=>{
 const s=setup(),occluder=new Mesh(new PlaneGeometry(2,2),new MeshBasicMaterial());occluder.position.z=1;occluder.userData.editorSelection={kind:'placement',id:'already-placed'};s.model.add(occluder);s.click();
 expect(s.choose).toHaveBeenCalledWith(null,null);s.preview.dispose();
});
it('native confirmation focus blur clears held input but keeps the stable actual ghost; Escape cancels and disposes only owned materials',async()=>{
 const s=setup();await Promise.resolve();s.target();
 expect(s.load).toHaveBeenCalledTimes(1);expect(s.scene.children).toHaveLength(2);expect(s.material.opacity).toBe(1);expect(s.release).not.toHaveBeenCalled();
 s.event('pointerdown');s.host.dispatchEvent(new Event('blur'));s.event('click');expect(s.choose).not.toHaveBeenCalled();expect(s.cancel).not.toHaveBeenCalled();
 s.host.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape'}));expect(s.cancel).toHaveBeenCalledTimes(1);expect(s.release).toHaveBeenCalledTimes(1);s.preview.dispose();expect(s.release).toHaveBeenCalledTimes(1);expect(s.scene.children).toEqual([s.model]);
});
it('cancelled generation aborts its pending asset and releases a late completion without attaching it',async()=>{
 const s=setup(true),signal=s.load.mock.calls[0]![1] as AbortSignal;s.clear();expect(signal.aborted).toBe(true);s.resolve();await Promise.resolve();expect(s.release).toHaveBeenCalledTimes(1);expect(s.cancel).not.toHaveBeenCalled();s.preview.dispose();
});

it('keeps the exact room × placement matrix for a rotated ghost under nonuniform room scale',()=>{
 const s=setup();s.room.scale.set(2,3,4);s.room.rotation.z=.3;const rotation=[0,Math.sin(.4),0,Math.cos(.4)];s.target(rotation);
 const expected=new Matrix4().copy(s.room.matrixWorld).multiply(new Matrix4().compose(new Vector3(),new Quaternion(...rotation),new Vector3(1,1,1)));
 expect(s.scene.children[1]!.matrix.elements).toEqual(expected.elements);expect(s.scene.children[1]!.matrixAutoUpdate).toBe(false);s.preview.dispose();
});
