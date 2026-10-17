import {BoxHelper,Raycaster,Vector2,type Camera,type Object3D,type Scene,type WebGLRenderer} from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {applyGeometryCommand,createGeometryState,type GeometryCommand} from './model';
import {alignedWall,closestEditorSelection,commandForPose,localPose,selectionKey,type EditorBridge,type EditorSelection,type Pose} from './direct-edit';
function pose(target:Object3D,p:Pose){target.position.fromArray(p.position);target.quaternion.fromArray(p.rotation);target.scale.fromArray(p.scale);target.updateMatrixWorld(true);}
function visual(target:Object3D,doc:EditorBridge['document'],selection:EditorSelection){
 pose(target,localPose(doc,selection));
 if(selection.kind==='room'){const room=doc.rooms.find(r=>r.id===selection.id),outline=target.userData.dimensionOutline as Object3D|undefined,base=outline?.userData.dimensionReference;if(room&&outline&&base){outline.scale.set(room.dimensions.width/base.width,room.dimensions.height/base.height,room.dimensions.depth/base.depth);outline.position.y=room.dimensions.height/2;outline.updateMatrixWorld(true);}}
}
/** Editor-only adapter over the existing renderer and command model. No Viewer install. */
export function installPreviewEditing({scene,camera,renderer,model,targets,orbit,bridge,render}:{scene:Scene;camera:Camera;renderer:WebGLRenderer;model:Object3D;targets:Map<string,Object3D>;orbit:{enabled:boolean};bridge:()=>EditorBridge|undefined;render:()=>void}){
 const control=new TransformControls(camera,renderer.domElement);scene.add(control.getHelper());
 let highlight:BoxHelper|undefined,highlightKey='',lastVisual:Object3D|undefined;
 let active:{doc:EditorBridge['document'];selection:EditorSelection;mode:EditorBridge['mode'];view:string;target:Object3D;pose:Pose;command:GeometryCommand|null;orbit:boolean}|null=null;
 let down:{x:number;y:number;pointerId:number}|undefined;
 function report(error:unknown){bridge()?.error(error instanceof Error?error.message:'위치를 확인하고 다시 조절해 주세요.');}
 function clearHighlight(){if(highlight){scene.remove(highlight);highlight.geometry.dispose();const materials=Array.isArray(highlight.material)?highlight.material:[highlight.material];materials.forEach(m=>m.dispose());highlight=undefined;}}
 function cancel(){const previous=active,pointer=down;active=null;down=undefined;if(previous){pose(previous.target,previous.pose);control.pointerUp(null);bridge()?.previewChange(null);if(pointer)renderer.domElement.dispatchEvent(new PointerEvent('pointercancel',{pointerId:pointer.pointerId,bubbles:true}));orbit.enabled=previous.orbit;}if(pointer&&renderer.domElement.hasPointerCapture(pointer.pointerId))renderer.domElement.releasePointerCapture(pointer.pointerId);render();}
 function sync(){
  const b=bridge();if(!b)return;
  if(active&&(active.doc!==b.document||active.mode!==b.mode||active.view!==b.view||!b.selection||selectionKey(active.selection)!==selectionKey(b.selection)||b.disabled)){cancel();}
  const key=b.selection?selectionKey(b.selection):'',target=targets.get(key);
  if(lastVisual&&(!target||lastVisual!==target)&&!active){const old=lastVisual.userData.editorSelection as EditorSelection|undefined;if(old)try{visual(lastVisual,b.document,old);}catch{/* removed target */}}
  if(target&&!active&&b.selection){let doc=b.document;try{if(b.preview)doc=applyGeometryCommand(createGeometryState(doc),b.preview).present;visual(target,doc,b.selection);lastVisual=target;}catch(error){report(error);}}
  const freePose=(()=>{try{return !b.selection||!alignedWall(b.document,b.selection);}catch{return false;}})(),rotateAllowed=b.selection?.kind!=='opening'&&freePose;
  if(target&&!b.disabled&&b.mode!=='dimensions'&&(b.mode!=='rotate'||rotateAllowed)){if(control.object!==target)control.attach(target);if(control.mode!==b.mode)control.setMode(b.mode);control.setSpace('local');control.showZ=b.selection?.kind!=='opening'&&freePose;}
  else control.detach();
  if(key!==highlightKey){clearHighlight();highlightKey=key;if(target){highlight=new BoxHelper(target,0x007f75);scene.add(highlight);}}
  highlight?.update();render();
 }
 control.addEventListener('mouseDown',()=>{const b=bridge(),target=control.object;if(!b||b.disabled||!b.selection||!target)return;active={doc:b.document,selection:structuredClone(b.selection),mode:b.mode,view:b.view,target,pose:localPose(b.document,b.selection),command:null,orbit:orbit.enabled};orbit.enabled=false;});
 control.addEventListener('objectChange',()=>{
  const a=active,b=bridge();if(!a||!b)return;if(a.doc!==b.document){cancel();return;}
  try{const raw:Pose={position:a.target.position.toArray(),rotation:a.target.quaternion.clone().normalize().toArray(),scale:[...a.pose.scale]};const command=commandForPose(a.doc,a.selection,raw),candidate=applyGeometryCommand(createGeometryState(a.doc),command).present;pose(a.target,localPose(candidate,a.selection));a.command=command;b.previewChange(command);highlight?.update();render();}
  catch(error){a.command=null;pose(a.target,a.pose);b.previewChange(null);report(error);render();}
 });
 control.addEventListener('mouseUp',()=>{const a=active,b=bridge();active=null;if(!a)return;orbit.enabled=a.orbit;b?.previewChange(null);if(b&&!b.disabled&&a.doc===b.document&&b.selection&&selectionKey(a.selection)===selectionKey(b.selection)&&a.command)b.commit(a.command);else pose(a.target,a.pose);render();});
 const onDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY,pointerId:e.pointerId};};
 const onClick=(e:MouseEvent)=>{
  if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5||control.axis)return;
  const b=bridge();if(!b)return;const rect=renderer.domElement.getBoundingClientRect(),ray=new Raycaster();ray.setFromCamera(new Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
  const hits=ray.intersectObject(model,true),selections=hits.flatMap(hit=>{let node:Object3D|null=hit.object;while(node){if(node.userData.editorSelection)return [{distance:hit.distance,selection:node.userData.editorSelection as EditorSelection}];node=node.parent;}return [];});
  const picked=closestEditorSelection(selections);if(picked)b.select(picked);
 };
 const lostCapture=()=>queueMicrotask(()=>{if(active)cancel();});
 const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&active){e.preventDefault();cancel();}};
 renderer.domElement.addEventListener('pointerdown',onDown,true);renderer.domElement.addEventListener('click',onClick);renderer.domElement.addEventListener('pointercancel',cancel);renderer.domElement.addEventListener('lostpointercapture',lostCapture);window.addEventListener('blur',cancel);window.addEventListener('keydown',key);control.addEventListener('change',render);
 sync();
 return {sync,dispose(){cancel();renderer.domElement.removeEventListener('pointerdown',onDown,true);renderer.domElement.removeEventListener('click',onClick);renderer.domElement.removeEventListener('pointercancel',cancel);renderer.domElement.removeEventListener('lostpointercapture',lostCapture);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key);control.dispose();scene.remove(control.getHelper());clearHighlight();}};
}
