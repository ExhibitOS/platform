// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {isBuiltInGalleryStool,furnishingWalkingCollisionLookup,benchesFor,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceBenchVisual,validateWorkspaceFurnishings,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {AssetPeakBudget,type DeviceBudget} from '../viewer/loading';
import {OwnerPreviewBudget} from './owner-preview-budget';
import {mountOwnerWorkspacePlacement} from './owner-placement';
import type {WorkspaceModelSource} from './model-loader';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import {furnishingCollisionMesh,type MountedFurnishingCollision} from '../viewer/furnishing-collision-mesh';

const retiredLedgers=new Set<AssetPeakBudget>();
/** Delegate peak accounting to the Viewer while tracking only furnishing holds
 * for quarantine; unrelated artwork holds must never block another scene. */
class FurnishingPeakBudget extends AssetPeakBudget {
 private readonly owned=new Map<string,number>();
 constructor(private readonly shared:AssetPeakBudget){super(1,()=>0);}
 override reserve(key:string,bytes:number,limitBytes?:number){this.shared.reserve(key,bytes,limitBytes);this.owned.set(key,bytes);}
 override release(key:string){this.shared.release(key);this.owned.delete(key);}
 override reservedBytes(){return [...this.owned.values()].reduce((sum,value)=>sum+value,0);}
 override total(except?:string){return this.shared.total(except);}
}

/** Conservative scene draw/triangle usage includes hidden meshes and groups. */
export function existingSceneCost(three:typeof Three,scene:Three.Object3D,ghost=false){
 let draws=0,triangles=0;
 scene.traverse(node=>{if(!(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points))return;const materials=Array.isArray(node.material)?node.material:[node.material],geometry=node.geometry,instances=node instanceof three.InstancedMesh?node.count:1;
  if(!Number.isSafeInteger(instances)||instances<0)throw Error('WORKSPACE_SCENE_BUDGET');const passes=materials.reduce((n,m)=>n+((ghost||m.transparent)&&m.side===three.DoubleSide&&!m.forceSinglePass?2:1),0),groups=Array.isArray(node.material)?Math.max(1,geometry.groups.length):1,count=geometry.index?.count??geometry.attributes.position?.count??0;
  draws+=passes*groups*instances;if(node instanceof three.Mesh)triangles+=Math.ceil(count/3)*passes*groups*instances;
 });if(!Number.isSafeInteger(draws)||!Number.isSafeInteger(triangles))throw Error('WORKSPACE_SCENE_BUDGET');return {draws,triangles};
}
/** Call enforce before every render and dispose on teardown. Authority is
 * supplied by the owner source or an explicitly checked publication source. */
export function createOwnerFurnishingScene(options:{three:typeof Three;renderer:Three.WebGLRenderer;scene:Three.Object3D;rooms:Map<string,Three.Group>;candidate:{extensions?:Record<string,unknown>;rooms?:unknown};tenantId:string;signal:AbortSignal;unavailable:()=>boolean;budget:DeviceBudget;transitionBytes:number;resident:()=>number;changed:()=>void;fetcher?:typeof fetch;ledger?:AssetPeakBudget;modelSource?:(descriptor:WorkspaceFurnishingDescriptor)=>WorkspaceModelSource;publicAuthority?:{check:(signal:AbortSignal)=>Promise<void>;valid:()=>boolean};disposeSource?:()=>void}){
 for(const ledger of retiredLedgers){if(ledger.reservedBytes()>0)throw Error('WORKSPACE_SCENE_DRAINING');retiredLedgers.delete(ledger);}
 if(!validateWorkspaceFurnishings(options.candidate).valid)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const extension=options.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined;if(!extension)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const targets=(options.candidate as {placements?:{id:string;roomId:string}[]}).placements??[];
 const sceneDocument=options.candidate as unknown as Exhibition;
 const collisionEnabled=furnishingWalkingCollisionLookup(sceneDocument);
 const visualRows=[...extension.placements.map(p=>({...p,frameAttachment:undefined,openingAttachment:undefined})),...(extension.frameAttachments??[]).map(a=>({id:a.placementId,roomId:targets.find(p=>p.id===a.placementId)?.roomId??'',furnishingId:a.furnishingId,furnishingVersion:a.furnishingVersion,frameAttachment:a,openingAttachment:undefined})),...(extension.openingAttachments??[]).map(a=>{const opening=sceneDocument.openings.find(o=>o.id.toLowerCase()===a.openingId.toLowerCase()),wall=sceneDocument.surfaces.find(s=>s.id.toLowerCase()===opening?.surfaceId.toLowerCase());return {id:a.openingId,roomId:wall?.roomId??'',furnishingId:a.furnishingId,furnishingVersion:a.furnishingVersion,frameAttachment:undefined,openingAttachment:a};})];
 // A per-model geometry limit does not describe the aggregate of several
 // approved artworks, architecture and furnishings in the desktop gallery.
 const sceneTriangles=options.budget.maxSceneTriangles??options.budget.maxTriangles;
 const cost=existingSceneCost(options.three,options.scene),remainingDraws=256-cost.draws,remainingTriangles=sceneTriangles-cost.triangles;
 if(remainingDraws<1||remainingTriangles<1||!Number.isSafeInteger(options.transitionBytes)||options.transitionBytes<1)throw Error('WORKSPACE_SCENE_BUDGET');
 const scope=new OwnerPreviewBudget(options.tenantId,options.fetcher??fetch,remainingDraws,remainingTriangles),ledger=options.ledger?new FurnishingPeakBudget(options.ledger):new AssetPeakBudget(options.transitionBytes,options.resident),controller=new AbortController(),parent=()=>controller.abort(options.signal.reason);options.signal.addEventListener('abort',parent,{once:true});if(options.signal.aborted)parent();
 type Mounted = Awaited<ReturnType<typeof mountOwnerWorkspacePlacement>>;
 const handles=new Set<Mounted>(),mountedSeats=new Map<string,Mounted>(),retiredSeats=new Set<string>();
 const mountedBarriers=new Map<string,Mounted>(),mountedStools=new Map<string,Mounted>();
 const mountedCollision=new Map<string,MountedFurnishingCollision>();
 const seats=new Map(benchesFor(sceneDocument).flatMap(bench=>bench.workspaceVisual?[[bench.workspaceVisual.placementId.toLowerCase(),bench] as const]:[]));
 let finished=false,stopped=false,failed=0,loaded=0,checking=false,timer:ReturnType<typeof setInterval>|undefined,expiryTimer:ReturnType<typeof setTimeout>|undefined;
 const sharedCheck=()=>scope.check('publication-authority',controller.signal,async signal=>{if(!options.publicAuthority?.valid())throw Error('WORKSPACE_MODEL_AUTHORITY');await options.publicAuthority.check(signal);signal.throwIfAborted();if(!options.publicAuthority.valid())throw Error('WORKSPACE_MODEL_AUTHORITY');});
 const changed=()=>{if(!stopped)options.changed();};
 const dispose=()=>{if(stopped)return;stopped=true;controller.abort();if(timer)clearInterval(timer);if(expiryTimer)clearTimeout(expiryTimer);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',enforce);options.signal.removeEventListener('abort',parent);for(const handle of handles)try{handle.dispose();}catch{/* Uncertain cleanup keeps its budget held. */}handles.clear();mountedSeats.clear();mountedBarriers.clear();mountedStools.clear();mountedCollision.clear();try{options.disposeSource?.();}catch{/* Failed cleanup retains any corresponding budget holds. */}if(ledger.reservedBytes()>0)retiredLedgers.add(ledger);};
 const enforce=()=>{if(options.modelSource&&!stopped){const cost=existingSceneCost(options.three,options.scene);if(!options.publicAuthority?.valid()||cost.draws>256||cost.triangles>sceneTriangles){failed+=loaded;loaded=0;dispose();options.changed();return;}}for(const handle of handles)handle.enforce();};
 const seatAvailability=(link:WorkspaceBenchVisual):'pending'|'ready'|'unavailable'=>{
  const id=link.placementId.toLowerCase(),bench=seats.get(id);
  if(stopped||controller.signal.aborted||options.unavailable()||retiredSeats.has(id)||bench?.workspaceVisual?.modelSha256!==link.modelSha256
   ||options.publicAuthority&&!options.publicAuthority.valid())return 'unavailable';
  const handle=mountedSeats.get(id);
  if(!handle)return finished?'unavailable':'pending';
  if(!handle.seatFootprintMatches)return 'unavailable';
  return handle.object.visible?'ready':'pending';
 };
 const localSeatDimensions=(id:string,scale:number)=>{
  const dimensions=seats.get(id)?.dimensions;
  if(dimensions)return {width:dimensions.width/scale,depth:dimensions.depth/scale,height:dimensions.height/scale};
 };
 const start=async()=>{if(options.publicAuthority){try{await sharedCheck();}catch{failed=visualRows.length;dispose();changed();return {loaded,failed};}}for(const placement of visualRows){if(stopped||controller.signal.aborted)break;const placementKey=placement.id.toLowerCase();const room=options.rooms.get(placement.roomId.toLowerCase());if(!room){failed++;changed();continue;}try{const ref:{current?:Awaited<ReturnType<typeof mountOwnerWorkspacePlacement>>}={};const descriptor=extension.furnishings.find(item=>item.id===placement.furnishingId&&item.version===placement.furnishingVersion);if(!descriptor)throw Error('WORKSPACE_PLACEMENT_INVALID');const handle=await mountOwnerWorkspacePlacement({three:options.three,renderer:options.renderer,candidate:options.candidate,scope,roomId:placement.roomId,placementId:placement.id,...(placement.frameAttachment?{frameAttachment:placement.frameAttachment}:{}),...(placement.openingAttachment?{openingAttachment:placement.openingAttachment}:{}),room,signal:controller.signal,unavailable:options.unavailable,budget:options.budget,ledger,...(options.modelSource?{source:{...options.modelSource(descriptor),check:async()=>{if(!options.publicAuthority?.valid())throw Error('WORKSPACE_MODEL_AUTHORITY');}},sceneManagedAuthority:true}:{}),seatDimensions:'scale' in placement?localSeatDimensions(placementKey,placement.scale):undefined,onVisibilityChange:changed,onRevoked:()=>{if(stopped||!ref.current||!handles.delete(ref.current))return;if(mountedSeats.delete(placementKey))retiredSeats.add(placementKey);mountedBarriers.delete(placementKey);mountedStools.delete(placementKey);mountedCollision.delete(placementKey);loaded--;failed++;changed();}});ref.current=handle;if(stopped||controller.signal.aborted){handle.dispose();break;}if(options.publicAuthority)handle.object.visible=false;handles.add(handle);if(seats.has(placementKey))mountedSeats.set(placementKey,handle);if(descriptor.kind==='barrier')mountedBarriers.set(placementKey,handle);if(descriptor.kind==='stool')mountedStools.set(placementKey,handle);
 const kind=placement.frameAttachment?'frame':placement.openingAttachment?'opening':'workspace';
 if(options.publicAuthority&&!(kind==='workspace'&&(seats.has(placementKey)||isBuiltInGalleryStool(descriptor)))&&collisionEnabled(kind,placement.id)){
  const mesh=furnishingCollisionMesh(options.three,handle.object);
  if(mesh)mountedCollision.set(placementKey,{id:placementKey,mesh,active:()=>!stopped&&!options.unavailable()&&options.publicAuthority?.valid()===true&&handle.object.visible&&!!handle.object.parent});
 }
 loaded++;changed();}catch{if(!stopped&&!controller.signal.aborted){failed++;changed();}}}
 if(options.publicAuthority&&!stopped){
  try{await sharedCheck();if(!options.publicAuthority.valid())throw Error('WORKSPACE_MODEL_AUTHORITY');for(const handle of handles)handle.object.visible=true;changed();}catch{failed+=loaded;loaded=0;dispose();options.changed();return {loaded,failed};}
  if(typeof document!=='undefined')document.addEventListener('visibilitychange',enforce);
  const expiries=extension.furnishings.map(item=>(item.rights as {expiresAt?:unknown}|null)?.expiresAt).filter((value):value is string=>typeof value==='string').map(value=>Date.parse(value)).filter(Number.isFinite),earliest=Math.min(...expiries);
  const schedule=()=>{if(!Number.isFinite(earliest)||stopped)return;expiryTimer=setTimeout(()=>{enforce();if(!stopped)schedule();},Math.min(2147483647,Math.max(0,earliest-Date.now())));};schedule();
  timer=setInterval(()=>{enforce();if(stopped||checking)return;checking=true;for(const handle of handles)handle.object.visible=false;changed();void sharedCheck().then(()=>{enforce();if(!stopped){for(const handle of handles)handle.object.visible=true;changed();}}).catch(()=>{if(!stopped){failed+=loaded;loaded=0;dispose();options.changed();}}).finally(()=>{checking=false;});},5000);
 }
 finished=true;if(seats.size)changed();
 return {loaded,failed};};
 const publicBarrier=(id:string)=>{
  if(stopped||controller.signal.aborted||options.unavailable()||!options.publicAuthority?.valid())return;
  const object=mountedBarriers.get(id.toLowerCase())?.object;
  if(object?.visible&&object.parent)return object;
 };
 const stoolVisible=(id:string)=>{
  if(stopped||controller.signal.aborted||options.unavailable()||!options.publicAuthority?.valid())return false;
  const handle=mountedStools.get(id.toLowerCase());
  return Boolean(handle?.object.visible&&handle.object.parent);
 };
 return {start,enforce,dispose,ledger,seatAvailability,publicBarrier,stoolVisible,walkingCollisions:()=>[...mountedCollision.values()],reservePreview:(draws:number,triangles:number)=>scope.reserve(draws,triangles),stats:()=>({loaded,failed})};
}
