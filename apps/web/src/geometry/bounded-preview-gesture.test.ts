// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {afterEach,expect,it,vi} from 'vitest';
import {BoxGeometry,Mesh,MeshBasicMaterial,Object3D,PerspectiveCamera,Scene} from 'three';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {newDraft} from '../drafts/example';
import {geometryProposal,type NativeViewportFrame} from '../native-viewport-protocol';
import type {EditorBridge} from './direct-edit';
import {installPreviewEditing} from './preview-editing';

const holder=vi.hoisted(()=>({control:undefined as undefined|{dispatchEvent:(e:Event)=>boolean}}));
vi.mock('three/addons/controls/TransformControls.js',async()=>{
 const {Object3D}=await import('three');
 class Control extends EventTarget {
  object:Object3D|undefined;helper=new Object3D();mode='translate';enabled=true;axis=null;showX=true;showY=true;showZ=true;
  constructor(){super();holder.control=this;}
  getHelper(){return this.helper;} attach(target:Object3D){this.object=target;} detach(){this.object=undefined;}
  setMode(mode:string){this.mode=mode;} setSpace(){} pointerUp(){} dispose(){}
 }
 return {TransformControls:Control};
});
afterEach(()=>{vi.unstubAllGlobals();holder.control=undefined;});

it('previews and commits one bounded drag and cancels if selection changes before release',async()=>{
 const archive=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),draft=newDraft();draft.candidate=archive.exhibition;draft.exhibitionId=draft.candidate.id;
 const image=draft.candidate.artworks.find(a=>a.artworkType==='image')!;
 for(let i=0;i<10;i++){const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`drag-${i}.png`;a.assets[0]!.bytes=32*1024*1024;draft.candidate.artworks.push(a);}
 const selected=draft.candidate.placements[0]!,selection={kind:'placement' as const,id:selected.id};
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection,mode:'translate',view:'isometric',cameraSequence:0,transparent:false,disabled:false};
 const commit=vi.fn(),error=vi.fn(),preview=vi.fn(),bridge:EditorBridge={document:draft.candidate,selection,mode:'translate',view:'isometric',disabled:false,preview:null,select:()=>{},previewChange:preview,commit,error,propose:command=>geometryProposal(frame,command,true)};
 const doc=new EventTarget() as EventTarget&{hidden:boolean};doc.hidden=false;const element=new EventTarget() as EventTarget&{ownerDocument:typeof doc};element.ownerDocument=doc;vi.stubGlobal('window',new EventTarget());
 const scene=new Scene(),target=new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial()),model=new Object3D();scene.add(target);
 const adapter=installPreviewEditing({scene,camera:new PerspectiveCamera(),renderer:{domElement:element} as never,model,targets:new Map([['placement:'+selected.id,target]]),orbit:{enabled:true},bridge:()=>bridge,render:()=>{}});
 const control=holder.control!;control.dispatchEvent(new Event('mouseDown'));target.position.x+=0.01;control.dispatchEvent(new Event('objectChange'));control.dispatchEvent(new Event('mouseUp'));
 expect(error).not.toHaveBeenCalled();expect(commit).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0]![0]).toMatchObject({type:'set-placement',id:selected.id});expect(preview).toHaveBeenCalled();
 commit.mockClear();control.dispatchEvent(new Event('mouseDown'));target.position.x+=0.01;control.dispatchEvent(new Event('objectChange'));bridge.selection=null;control.dispatchEvent(new Event('mouseUp'));expect(commit).not.toHaveBeenCalled();
 adapter.dispose();target.geometry.dispose();target.material.dispose();
});
