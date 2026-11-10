// SPDX-License-Identifier: AGPL-3.0-or-later
import {BoxGeometry,BoxHelper,EdgesGeometry,Group,LineBasicMaterial,LineSegments,Mesh,Raycaster,Vector2,type Material,type Object3D} from 'three';
import type {PlacementPreviewContext} from './geometry/placement-preview';
import type {NativePlacement} from './native-placement';
import type {NativePlacementIntent} from './native-placement';
import type {CatalogDropHit,CatalogDropRequest} from './native-catalog-drop';

/** One ghost on the existing scene. Primary clicks select a real, nearest mesh. */
export function installNativePlacementPreview(placement:NativePlacement,context:PlacementPreviewContext){
 const {scene,model,camera,renderer,rooms,surfaces,document,render}=context,canvas=renderer.domElement;
 const ghost=new Group();ghost.matrixAutoUpdate=false;scene.add(ghost);ghost.visible=false;
 let outline:BoxHelper|undefined;
 const clearHighlight=()=>{if(outline){outline.removeFromParent();outline.dispose();outline=undefined;render();}};
 let disposed=false,intent:NativePlacementIntent|null=null,abort:AbortController|null=null;
 let releaseAsset=()=>{},materials:Material[]=[],boundsRelease=()=>{};
 let down:{x:number;y:number;pointerId:number}|null=null;
 const clearAsset=()=>{abort?.abort();abort=null;ghost.clear();materials.forEach(m=>m.dispose());materials=[];boundsRelease();boundsRelease=()=>{};releaseAsset();releaseAsset=()=>{};};
 function sync(){
  if(disposed)return;
  const next=placement.snapshot();
  if(next!==intent){clearAsset();intent=next;}
  ghost.visible=!!next?.target;
  if(next?.target){
   const room=rooms.get(next.request.roomId.toLowerCase()),pose=next.target.placement.transform;
   if(room){ghost.position.fromArray(pose.position);ghost.quaternion.fromArray(pose.rotation);ghost.scale.fromArray(pose.scale);room.updateWorldMatrix(true,false);ghost.updateMatrix();ghost.matrix.premultiply(room.matrixWorld);ghost.matrixWorldNeedsUpdate=true;}
   else ghost.visible=false;
  }
  if(next?.artwork&&!abort){
   const active=next,artwork=next.artwork,controller=new AbortController();abort=controller;
   void context.load(artwork,controller.signal).then(asset=>{
    if(disposed||controller.signal.aborted||placement.snapshot()!==active){asset.release();return;}
    releaseAsset=asset.release;
    const box=new BoxGeometry(artwork.dimensions.width,artwork.dimensions.height,artwork.dimensions.depth??.01),edges=new EdgesGeometry(box),lineMaterial=new LineBasicMaterial({color:0x007f75,transparent:true,opacity:.8});
    const outline=new LineSegments(edges,lineMaterial),assertion=new Group();assertion.position.fromArray(artwork.transform.position);assertion.quaternion.fromArray(artwork.transform.rotation);assertion.scale.fromArray(artwork.transform.scale);assertion.add(outline);ghost.add(assertion);
    boundsRelease=()=>{box.dispose();edges.dispose();lineMaterial.dispose();};
    const object=asset.object.clone(true);
    object.traverse(node=>{if(node instanceof Mesh){const clone=(m:Material)=>{const c=m.clone();c.transparent=true;c.opacity*=.55;c.depthWrite=false;materials.push(c);return c;};node.material=Array.isArray(node.material)?node.material.map(clone):clone(node.material);node.castShadow=false;node.receiveShadow=false;}});
    ghost.add(object);render();
   }).catch(()=>{if(!disposed&&!controller.signal.aborted&&placement.snapshot()===active)placement.cancel('작품 미리보기를 표시하지 못했어요. 숫자 편집으로 배치하거나 다시 시도하세요.');});
  }
  render();
 }
 const stop=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
 const pointerDown=(event:PointerEvent)=>{
  if(!placement.active||event.button!==0)return;
  stop(event);down=event.isPrimary!==false&&!event.ctrlKey&&!event.metaKey&&!event.altKey?{x:event.clientX,y:event.clientY,pointerId:event.pointerId}:null;
 };
 const pointerUp=(event:PointerEvent)=>{if(placement.active&&event.button===0)stop(event);};
 const pick=(point:{x:number;y:number})=>{
  model.updateWorldMatrix(true,true);camera.updateWorldMatrix(true,false);
  const ray=new Raycaster();ray.setFromCamera(new Vector2(point.x*2-1,1-point.y*2),camera);
  const hit=ray.intersectObject(model,true).find(({object})=>{
   if(!(object instanceof Mesh))return false;
   const materials=Array.isArray(object.material)?object.material:[object.material];
   if(!materials.some(material=>material.visible))return false;
   for(let node:Object3D|null=object;node;node=node.parent)if(!node.visible||node.userData.sceneSnapshotOverlay)return false;
   return true;
  });
  let node:Object3D|null=hit?.object??null;
  while(node&&!node.userData.editorSelection)node=node.parent;
  const selection=node?.userData.editorSelection as {kind:string;id:string}|undefined;
  return {hit,node,selection};
 };
 const choose=(point:{x:number;y:number})=>{
  const {hit,selection}=pick(point);
  const surface=selection?.kind==='surface'?surfaces.get(selection.id.toLowerCase()):null;
  if(hit&&surface){const local=surface.worldToLocal(hit.point.clone());placement.choose(selection!.id,[local.x,local.y]);}
  else placement.choose(null,null);
  sync();
 };
 const catalogDrop=(request:CatalogDropRequest):CatalogDropHit|null=>{
  clearHighlight();
  if(request.phase==='clear')return null;
  if(request.targetKind==='artwork'){
   const active=placement.snapshot();
   if(active?.request.requestId!==request.placementRequestId||!active.artwork||active.committing)throw Error('PLACEMENT_INTENT_STALE');
   choose(request.point);
   return placement.snapshot()===active&&active.target?{kind:'artwork'}:null;
  }
  const {hit,node,selection}=pick(request.point);
  if(!hit)return null;
  let result:CatalogDropHit|null=null,object:Object3D=hit.object;
  if(request.targetKind==='light'&&hit.object.userData.exhibitosLightFixture===true){
   const light=document.lights.find(light=>light.type==='spot'&&light.id===hit.object.userData.lightId);
   if(light){result={kind:'light',lightId:light.id};object=hit.object.parent??hit.object;}
  }
  if(request.targetKind==='frame'&&selection?.kind==='placement'){
   const target=document.placements.find(row=>row.id===selection.id);
   if(target&&document.artworks.some(art=>art.revisionId===target.artworkRevisionId&&art.artworkType==='image'&&art.schemaVersion==='1.0.0-draft.1')){
    result={kind:'frame',placementId:target.id};object=node??hit.object;
   }
  }
  if(request.targetKind==='floor'){
   const floor=selection?.kind==='surface'?document.surfaces.find(row=>row.id===selection.id&&row.type==='floor'):undefined;
   const roomId=floor?.roomId??(selection?.kind==='room'&&hit.object.userData.catalogImplicitFloor===true?selection.id:undefined);
   const room=roomId&&rooms.get(roomId.toLowerCase());
   if(roomId&&room){
    const local=room.worldToLocal(hit.point.clone()),authored=document.rooms.find(row=>row.id===roomId);
    if(authored&&[local.x,local.y,local.z].every(Number.isFinite)&&Math.abs(local.x)<=authored.dimensions.width/2+1e-6&&Math.abs(local.z)<=authored.dimensions.depth/2+1e-6&&local.y>=-1e-6&&local.y<=authored.dimensions.height+1e-6)
     result={kind:'floor',roomId,position:[local.x,local.y,local.z]};
   }
  }
  if(result&&request.phase==='hover'){outline=new BoxHelper(object,0x007f75);scene.add(outline);render();}
  return result;
 };
 const click=(event:MouseEvent)=>{
  if(!placement.active||event.button!==0)return;
  stop(event);const start=down;down=null;
  if(!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)>5||placement.snapshot()?.committing)return;
  const rect=canvas.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return;
  choose({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height});
 };
 const clearPointer=()=>{down=null;};
 const key=(event:KeyboardEvent)=>{if(placement.active&&event.key==='Escape'){stop(event);clearPointer();placement.cancel('작품 배치를 취소했어요.');sync();}};
 const lost=()=>{clearHighlight();placement.cancel('3D 화면 연결이 중단되어 배치를 취소했어요.');sync();};
 canvas.addEventListener('pointerdown',pointerDown,true);canvas.addEventListener('pointerup',pointerUp,true);canvas.addEventListener('click',click,true);canvas.addEventListener('pointercancel',clearPointer);canvas.addEventListener('webglcontextlost',lost);
 window.addEventListener('blur',clearPointer);window.addEventListener('blur',clearHighlight);window.addEventListener('keydown',key,true);
 sync();
 return {sync,catalogDrop,clearHighlight,dispose(){if(disposed)return;disposed=true;clearPointer();clearHighlight();placement.cancel('3D 미리보기가 바뀌어 배치를 취소했어요.');clearAsset();scene.remove(ghost);canvas.removeEventListener('pointerdown',pointerDown,true);canvas.removeEventListener('pointerup',pointerUp,true);canvas.removeEventListener('click',click,true);canvas.removeEventListener('pointercancel',clearPointer);canvas.removeEventListener('webglcontextlost',lost);window.removeEventListener('blur',clearPointer);window.removeEventListener('blur',clearHighlight);window.removeEventListener('keydown',key,true);}};
}
