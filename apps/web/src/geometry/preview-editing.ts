import {BoxHelper,Raycaster,Vector2,type Camera,type Object3D,type Scene,type WebGLRenderer} from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {applyGeometryCommand,createGeometryState,type GeometryCommand} from './model';
import {alignedWall,closestEditorSelection,commandForPose,localPose,selectionKey,type EditorBridge,type EditorSelection,type Pose} from './direct-edit';
import {EditorPointerArbitration} from './editor-pointer-arbitration';
import type {CameraInteractionMode} from './camera-mode';
function pose(target:Object3D,p:Pose){target.position.fromArray(p.position);target.quaternion.fromArray(p.rotation);target.scale.fromArray(p.scale);target.updateMatrixWorld(true);}
function visual(target:Object3D,doc:EditorBridge['document'],selection:EditorSelection){
 pose(target,localPose(doc,selection));
 if(selection.kind==='room'){const room=doc.rooms.find(r=>r.id===selection.id),outline=target.userData.dimensionOutline as Object3D|undefined,base=outline?.userData.dimensionReference;if(room&&outline&&base){outline.scale.set(room.dimensions.width/base.width,room.dimensions.height/base.height,room.dimensions.depth/base.depth);outline.position.y=room.dimensions.height/2;outline.updateMatrixWorld(true);}}
}
/** Editor-only adapter over the existing renderer and command model. No Viewer install. */
export function installPreviewEditing({scene,camera,renderer,model,targets,orbit,bridge,previewDocument,render,resetOrbit,resumeOrbit,onCameraReset}:{scene:Scene;camera:Camera;renderer:WebGLRenderer;model:Object3D;targets:Map<string,Object3D>;orbit:{enabled:boolean};bridge:()=>EditorBridge|undefined;previewDocument?:(doc:EditorBridge['document'],selection:EditorSelection)=>void;render:()=>void;resetOrbit?:(ids:readonly number[])=>void;resumeOrbit?:()=>void;onCameraReset?:(reason:'hidden'|'unavailable')=>void}){
 const control=new TransformControls(camera,renderer.domElement);scene.add(control.getHelper());
 let highlight:BoxHelper|undefined,highlightKey='',lastVisual:Object3D|undefined;
 let active:{doc:EditorBridge['document'];selection:EditorSelection;mode:EditorBridge['mode'];view:string;target:Object3D;pose:Pose;command:GeometryCommand|null;orbit:boolean}|null=null;
 let down:{x:number;y:number;pointerId:number}|undefined;
 const pointers=new EditorPointerArbitration();let syntheticCancel=false,multiLocked=false,controlWasEnabled=true,disposed=false,hostDisabled=false,cameraMode:CameraInteractionMode='object';
 function report(error:unknown){bridge()?.error(error instanceof Error?error.message:'위치를 확인하고 다시 조절해 주세요.');}
 function clearHighlight(){if(highlight){scene.remove(highlight);highlight.geometry.dispose();const materials=Array.isArray(highlight.material)?highlight.material:[highlight.material];materials.forEach(m=>m.dispose());highlight=undefined;}}
 function cancel(notifyOrbit=true){const previous=active,pointer=down;active=null;down=undefined;if(previous){pose(previous.target,previous.pose);previewDocument?.(previous.doc,previous.selection);control.pointerUp(null);bridge()?.previewChange(null);if(pointer&&notifyOrbit){syntheticCancel=true;try{renderer.domElement.dispatchEvent(new PointerEvent('pointercancel',{pointerId:pointer.pointerId,bubbles:true}));}finally{syntheticCancel=false;}}if(notifyOrbit)orbit.enabled=previous.orbit;}if(pointer&&renderer.domElement.hasPointerCapture(pointer.pointerId))renderer.domElement.releasePointerCapture(pointer.pointerId);render();}
 function sync(){
  const b=bridge();if(!b)return;
  if(b.disabled&&(!hostDisabled||active||cameraMode!=='object')){hostDisabled=true;resetPointers('unavailable');return;}
  if(!b.disabled&&hostDisabled&&!pointers.busy&&!multiLocked&&!renderer.domElement.ownerDocument.hidden){hostDisabled=false;control.enabled=cameraMode==='object';resumeOrbit?.();}
  if(active&&(active.doc!==b.document||active.mode!==b.mode||active.view!==b.view||!b.selection||selectionKey(active.selection)!==selectionKey(b.selection)||b.disabled)){cancel();}
  const key=b.selection?selectionKey(b.selection):'',target=targets.get(key);
  if(lastVisual&&(!target||lastVisual!==target)&&!active){const old=lastVisual.userData.editorSelection as EditorSelection|undefined;if(old)try{visual(lastVisual,b.document,old);previewDocument?.(b.document,old);}catch{/* removed target */}}
  if(target&&!active&&b.selection){let doc=b.document;try{if(b.preview)doc=applyGeometryCommand(createGeometryState(doc),b.preview).present;visual(target,doc,b.selection);previewDocument?.(doc,b.selection);lastVisual=target;}catch(error){report(error);}}
  const freePose=(()=>{try{return !b.selection||!alignedWall(b.document,b.selection);}catch{return false;}})(),rotateAllowed=b.selection?.kind!=='opening'&&freePose;
  if(target&&!b.disabled&&cameraMode==='object'&&b.mode!=='dimensions'&&(b.mode!=='rotate'||rotateAllowed)){if(control.object!==target)control.attach(target);if(control.mode!==b.mode)control.setMode(b.mode);control.setSpace('local');const upright=!!b.uprightRooms&&b.selection?.kind==='room'&&b.mode==='rotate';control.showX=!upright;control.showY=true;control.showZ=!upright&&b.selection?.kind!=='opening'&&freePose;}
  else control.detach();
  if(key!==highlightKey){clearHighlight();highlightKey=key;if(target){highlight=new BoxHelper(target,0x007f75);scene.add(highlight);}}
  highlight?.update();render();
 }
 control.addEventListener('mouseDown',()=>{const b=bridge(),target=control.object;if(!b||b.disabled||!b.selection||!target)return;active={doc:b.document,selection:structuredClone(b.selection),mode:b.mode,view:b.view,target,pose:localPose(b.document,b.selection),command:null,orbit:orbit.enabled};orbit.enabled=false;});
 control.addEventListener('objectChange',()=>{
  const a=active,b=bridge();if(!a||!b)return;if(a.doc!==b.document){cancel();return;}
  try{const raw:Pose={position:a.target.position.toArray(),rotation:a.target.quaternion.clone().normalize().toArray(),scale:[...a.pose.scale]};const command=commandForPose(a.doc,a.selection,raw),candidate=applyGeometryCommand(createGeometryState(a.doc),command).present;pose(a.target,localPose(candidate,a.selection));previewDocument?.(candidate,a.selection);a.command=command;b.previewChange(command);highlight?.update();render();}
  catch(error){a.command=null;pose(a.target,a.pose);previewDocument?.(a.doc,a.selection);b.previewChange(null);report(error);render();}
 });
 control.addEventListener('mouseUp',()=>{const a=active,b=bridge();active=null;if(!a)return;orbit.enabled=a.orbit;b?.previewChange(null);if(b&&!b.disabled&&a.doc===b.document&&b.selection&&selectionKey(a.selection)===selectionKey(b.selection)&&a.command)b.commit(a.command);else {pose(a.target,a.pose);previewDocument?.(a.doc,a.selection);}render();});
 const docDown=(e:PointerEvent)=>{if(pointers.down(e.pointerId,e.target===renderer.domElement)){if(!multiLocked){multiLocked=true;controlWasEnabled=control.enabled;}if(active)cancel();control.enabled=false;}};
 const docEnd=(e:PointerEvent)=>{if(syntheticCancel)return;pointers.up(e.pointerId);if(!pointers.busy&&(multiLocked||hostDisabled))queueMicrotask(()=>{if(!disposed&&!pointers.busy){if(multiLocked){multiLocked=false;control.enabled=cameraMode==='object'&&controlWasEnabled&&!bridge()?.disabled&&!renderer.domElement.ownerDocument.hidden;}sync();}});};
 function resetPointers(reason:'hidden'|'unavailable'='unavailable'){const ids=pointers.activeIds,changed=cameraMode!=='object';pointers.clear();cancel(false);resetOrbit?.(ids);multiLocked=false;cameraMode='object';control.enabled=!bridge()?.disabled&&!renderer.domElement.ownerDocument.hidden;if(changed)onCameraReset?.(reason);sync();}
 const blur=()=>resetPointers('unavailable');
 const visibility=()=>{if(renderer.domElement.ownerDocument.hidden)resetPointers('hidden');else {control.enabled=cameraMode==='object'&&!multiLocked&&!bridge()?.disabled;if(!pointers.busy&&!multiLocked&&!bridge()?.disabled)resumeOrbit?.();sync();}};
 const onDown=(e:PointerEvent)=>{if(!pointers.suppressSelection)down={x:e.clientX,y:e.clientY,pointerId:e.pointerId};};
 const onClick=(e:MouseEvent)=>{
  if(cameraMode!=='object'||pointers.suppressSelection||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5||control.axis)return;
  const b=bridge();if(!b||b.disabled)return;const rect=renderer.domElement.getBoundingClientRect(),ray=new Raycaster();ray.setFromCamera(new Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
  const hits=ray.intersectObject(model,true),selections=hits.flatMap(hit=>{let node:Object3D|null=hit.object;while(node){if(node.userData.editorSelection)return [{distance:hit.distance,selection:node.userData.editorSelection as EditorSelection}];node=node.parent;}return [];});
  const picked=closestEditorSelection(selections);if(picked)b.select(picked);
 };
 const cancelEvent=()=>cancel();
 const lostCapture=()=>{const previous=active;queueMicrotask(()=>{if(previous&&active===previous)cancel();});};
 const dragOver=(e:DragEvent)=>{const b=bridge();if(cameraMode==='object'&&!multiLocked&&b&&!b.disabled&&b.dropArtwork&&e.dataTransfer?.types.includes('application/x-exhibitos-artwork')){e.preventDefault();e.dataTransfer.dropEffect='copy';}};
 const drop=(e:DragEvent)=>{
  const b=bridge(),id=e.dataTransfer?.getData('application/x-exhibitos-artwork');if(cameraMode!=='object'||multiLocked||!b||b.disabled||!b.dropArtwork||!id)return;
  e.preventDefault();cancel();const rect=renderer.domElement.getBoundingClientRect(),ray=new Raycaster();ray.setFromCamera(new Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
  for(const hit of ray.intersectObject(model,true)){let node:Object3D|null=hit.object;while(node&&!node.userData.editorSelection)node=node.parent;const picked=node?.userData.editorSelection as EditorSelection|undefined;if(picked?.kind==='surface'){b.dropArtwork(id,picked.id,hit.point.toArray() as [number,number,number]);return;}}
  report('작품을 놓을 벽을 선택해 주세요. 썸네일을 눌러 배치할 수도 있어요.');
 };
 const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&active){e.preventDefault();cancel();}};
 renderer.domElement.ownerDocument.addEventListener('pointerdown',docDown,true);renderer.domElement.ownerDocument.addEventListener('pointerup',docEnd,true);renderer.domElement.ownerDocument.addEventListener('pointercancel',docEnd,true);renderer.domElement.ownerDocument.addEventListener('visibilitychange',visibility);renderer.domElement.addEventListener('pointerdown',onDown,true);renderer.domElement.addEventListener('click',onClick);renderer.domElement.addEventListener('dragover',dragOver);renderer.domElement.addEventListener('drop',drop);renderer.domElement.addEventListener('pointercancel',cancelEvent);renderer.domElement.addEventListener('lostpointercapture',lostCapture);window.addEventListener('blur',blur);window.addEventListener('keydown',key);control.addEventListener('change',render);
 sync();
 return {sync,invalidate:(reason:'hidden'|'unavailable'='unavailable')=>resetPointers(reason),setCameraMode(mode:CameraInteractionMode){if(disposed||pointers.busy||multiLocked||mode!=='object'&&(!bridge()||bridge()?.disabled||renderer.domElement.ownerDocument.hidden))return false;if(active)cancel();down=undefined;cameraMode=mode;control.enabled=mode==='object';sync();return true;},dispose(){disposed=true;cancel();renderer.domElement.ownerDocument.removeEventListener('pointerdown',docDown,true);renderer.domElement.ownerDocument.removeEventListener('pointerup',docEnd,true);renderer.domElement.ownerDocument.removeEventListener('pointercancel',docEnd,true);renderer.domElement.ownerDocument.removeEventListener('visibilitychange',visibility);renderer.domElement.removeEventListener('pointerdown',onDown,true);renderer.domElement.removeEventListener('click',onClick);renderer.domElement.removeEventListener('dragover',dragOver);renderer.domElement.removeEventListener('drop',drop);renderer.domElement.removeEventListener('pointercancel',cancelEvent);renderer.domElement.removeEventListener('lostpointercapture',lostCapture);window.removeEventListener('blur',blur);window.removeEventListener('keydown',key);control.dispose();scene.remove(control.getHelper());clearHighlight();}};
}
