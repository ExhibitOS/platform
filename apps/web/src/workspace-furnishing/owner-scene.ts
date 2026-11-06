// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {AssetPeakBudget,type DeviceBudget} from '../viewer/loading';
import {OwnerPreviewBudget} from './owner-preview-budget';
import {mountOwnerWorkspacePlacement} from './owner-placement';

/** Conservative scene draw/triangle usage includes hidden meshes and groups. */
export function existingSceneCost(three:typeof Three,scene:Three.Object3D){
 let draws=0,triangles=0;
 scene.traverse(node=>{if(!(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points))return;const materials=Array.isArray(node.material)?node.material:[node.material],geometry=node.geometry,instances=node instanceof three.InstancedMesh?node.count:1;
  if(!Number.isSafeInteger(instances)||instances<0)throw Error('WORKSPACE_SCENE_BUDGET');const passes=materials.reduce((n,m)=>n+(m.transparent&&m.side===three.DoubleSide&&!m.forceSinglePass?2:1),0),groups=Array.isArray(node.material)?Math.max(1,geometry.groups.length):1,count=geometry.index?.count??geometry.attributes.position?.count??0;
  draws+=passes*groups*instances;if(node instanceof three.Mesh)triangles+=Math.ceil(count/3)*passes*groups*instances;
 });if(!Number.isSafeInteger(draws)||!Number.isSafeInteger(triangles))throw Error('WORKSPACE_SCENE_BUDGET');return {draws,triangles};
}
/** One native owner scene. Call enforce immediately before every render and
 * dispose on teardown. It never supplies public authority or an arbitrary URL. */
export function createOwnerFurnishingScene(options:{three:typeof Three;renderer:Three.WebGLRenderer;scene:Three.Object3D;rooms:Map<string,Three.Group>;candidate:{extensions?:Record<string,unknown>;rooms?:unknown};tenantId:string;signal:AbortSignal;unavailable:()=>boolean;budget:DeviceBudget;transitionBytes:number;resident:()=>number;changed:()=>void;fetcher?:typeof fetch}){
 if(!validateWorkspaceFurnishings(options.candidate).valid)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const extension=options.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined;if(!extension)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const cost=existingSceneCost(options.three,options.scene),remainingDraws=256-cost.draws,remainingTriangles=options.budget.maxTriangles-cost.triangles;
 if(remainingDraws<1||remainingTriangles<1||!Number.isSafeInteger(options.transitionBytes)||options.transitionBytes<1)throw Error('WORKSPACE_SCENE_BUDGET');
 const scope=new OwnerPreviewBudget(options.tenantId,options.fetcher??fetch,remainingDraws,remainingTriangles),ledger=new AssetPeakBudget(options.transitionBytes,options.resident),controller=new AbortController(),parent=()=>controller.abort(options.signal.reason);options.signal.addEventListener('abort',parent,{once:true});if(options.signal.aborted)parent();
 const handles=new Set<Awaited<ReturnType<typeof mountOwnerWorkspacePlacement>>>();let stopped=false,failed=0,loaded=0;
 const changed=()=>{if(!stopped)options.changed();};
 const dispose=()=>{if(stopped)return;stopped=true;controller.abort();options.signal.removeEventListener('abort',parent);for(const handle of handles)try{handle.dispose();}catch{/* Uncertain cleanup keeps its budget held. */}handles.clear();};
 const enforce=()=>{for(const handle of handles)handle.enforce();};
 const start=async()=>{for(const placement of extension.placements){if(stopped||controller.signal.aborted)break;const room=options.rooms.get(placement.roomId.toLowerCase());if(!room){failed++;changed();continue;}try{const ref:{current?:Awaited<ReturnType<typeof mountOwnerWorkspacePlacement>>}={};const handle=await mountOwnerWorkspacePlacement({three:options.three,renderer:options.renderer,candidate:options.candidate,scope,roomId:placement.roomId,placementId:placement.id,room,signal:controller.signal,unavailable:options.unavailable,budget:options.budget,ledger,onVisibilityChange:changed,onRevoked:()=>{if(ref.current&&handles.delete(ref.current))loaded--;failed++;changed();}});ref.current=handle;if(stopped||controller.signal.aborted){handle.dispose();break;}handles.add(handle);loaded++;changed();}catch{if(!stopped&&!controller.signal.aborted){failed++;changed();}}}return {loaded,failed};};
 return {start,enforce,dispose,ledger,reservePreview:(draws:number,triangles:number)=>scope.reserve(draws,triangles),stats:()=>({loaded,failed})};
}
