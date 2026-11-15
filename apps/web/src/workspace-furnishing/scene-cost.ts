// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {TransformControls,TransformControlsGizmo,TransformControlsPlane} from 'three/addons/controls/TransformControls.js';
import type {WorkspaceSceneDrawInventory} from './failure-readout';
type Cost={draws:number;triangles:number};
type Peak={cost:Cost;inventory:WorkspaceSceneDrawInventory};
type RegisteredControl={root:Three.Object3D;normal:Peak;ghost:Peak;valid:()=>boolean};
const roots=new WeakMap<Three.Object3D,RegisteredControl>(),descendants=new WeakMap<Three.Object3D,RegisteredControl>();
const emptyInventory=():WorkspaceSceneDrawInventory=>({meshDraws:0,instancedMeshDraws:0,lineDraws:0,pointsDraws:0,overlayDraws:0,directHiddenDraws:0,multiMaterialDraws:0});
function addInventory(target:WorkspaceSceneDrawInventory,source:WorkspaceSceneDrawInventory){for(const key of Object.keys(target) as (keyof WorkspaceSceneDrawInventory)[])target[key]+=source[key];}

/** Only the editor-owned Three control can register this mutually exclusive envelope.
 * Pickers remain in the scene for raycasting; the invisible drag plane also remains.
 * Reserve every handle of the largest mode, including hidden handles, plus the
 * independent maximum triangle cost. No current visibility discount is applied.
 */
export function registerTransformControlsSceneCost(three:typeof Three,control:TransformControls){
 const root=control.getHelper();if(!(control instanceof TransformControls)||roots.has(root))return ()=>{};
 const gizmo=root.children.find((node):node is TransformControlsGizmo=>node instanceof TransformControlsGizmo),plane=root.children.find((node):node is TransformControlsPlane=>node instanceof TransformControlsPlane);
 if(!gizmo||!plane||root.children.length!==2)return ()=>{};
 const modes=['translate','rotate','scale'] as const,groups=modes.flatMap(mode=>[gizmo.gizmo[mode],gizmo.helper[mode],gizmo.picker[mode]]);
 if(groups.some(group=>!group)||gizmo.children.length!==9||groups.some(group=>group.parent!==gizmo))return ()=>{};
 const nodes:Three.Object3D[]=[];root.traverse(node=>{if(node!==root)nodes.push(node);});
 const parents=nodes.map(node=>({node,parent:node.parent}));
 const bodies=nodes.flatMap(node=>{
  if(!(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points))return [];
  const geometry=node.geometry,materials=Array.isArray(node.material)?[...node.material]:[node.material];
  return [{node,geometry,arrayMaterial:Array.isArray(node.material),groupCount:geometry.groups.length,indexCount:geometry.index?.count,positionCount:geometry.attributes.position?.count,materials,traits:materials.map(material=>({material,transparent:material.transparent,side:material.side,forceSinglePass:material.forceSinglePass}))}];
 });
 const valid=()=>control.getHelper()===root&&modes.includes(control.mode)&&plane.material.visible===false&&modes.every(mode=>gizmo.picker[mode].visible===false)&&parents.every(row=>row.node.parent===row.parent)&&bodies.every(row=>{
  const materials=Array.isArray(row.node.material)?row.node.material:[row.node.material];
  return Array.isArray(row.node.material)===row.arrayMaterial&&row.geometry.groups.length===row.groupCount&&row.node.geometry===row.geometry&&row.geometry.index?.count===row.indexCount&&row.geometry.attributes.position?.count===row.positionCount&&materials.length===row.materials.length&&row.traits.every((trait,index)=>materials[index]===trait.material&&trait.material.transparent===trait.transparent&&trait.material.side===trait.side&&trait.material.forceSinglePass===trait.forceSinglePass);
 });
 if(!valid())return ()=>{};
 const peak=(ghost:boolean):Peak=>{
  const values=modes.map(mode=>{const inventory=emptyInventory(),a=existingSceneCost(three,gizmo.gizmo[mode],ghost,inventory),b=existingSceneCost(three,gizmo.helper[mode],ghost,inventory);return {cost:{draws:a.draws+b.draws,triangles:a.triangles+b.triangles},inventory};});
  const largest=values.reduce((a,b)=>a.cost.draws>=b.cost.draws?a:b);
  return {cost:{draws:largest.cost.draws,triangles:Math.max(...values.map(value=>value.cost.triangles))},inventory:largest.inventory};
 };
 const entry:RegisteredControl={root,normal:peak(false),ghost:peak(true),valid};roots.set(root,entry);for(const node of nodes)descendants.set(node,entry);
 let released=false;return ()=>{if(released)return;released=true;if(roots.get(root)===entry)roots.delete(root);for(const node of nodes)if(descendants.get(node)===entry)descendants.delete(node);};
}

/** Conservative scene draw/triangle usage includes hidden meshes and groups. */
export function existingSceneCost(three:typeof Three,scene:Three.Object3D,ghost=false,inventory?:WorkspaceSceneDrawInventory){
 let draws=0,triangles=0;const checked=new Map<RegisteredControl,boolean>();
 scene.traverse(node=>{
  const registered=roots.get(node)??descendants.get(node);
  if(registered){let valid=checked.get(registered);if(valid===undefined){valid=registered.valid();checked.set(registered,valid);}if(valid){if(node===registered.root){const peak=ghost?registered.ghost:registered.normal;draws+=peak.cost.draws;triangles+=peak.cost.triangles;if(inventory)addInventory(inventory,peak.inventory);}return;}}
  if(!(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points))return;const materials=Array.isArray(node.material)?node.material:[node.material],geometry=node.geometry,instances=node instanceof three.InstancedMesh?node.count:1;
  if(!Number.isSafeInteger(instances)||instances<0)throw Error('WORKSPACE_SCENE_BUDGET');const passes=materials.reduce((n,m)=>n+((ghost||m.transparent)&&m.side===three.DoubleSide&&!m.forceSinglePass?2:1),0),groups=Array.isArray(node.material)?Math.max(1,geometry.groups.length):1,count=geometry.index?.count??geometry.attributes.position?.count??0;
  // An instanced mesh submits one draw per pass/group; only triangle work scales
  // with its instance count (including zero instances producing no draw).
  const chargedDraws=instances>0?passes*groups:0;draws+=chargedDraws;if(node instanceof three.Mesh)triangles+=Math.ceil(count/3)*passes*groups*instances;
  if(inventory){
   const kind=node instanceof three.InstancedMesh?'instancedMeshDraws':node instanceof three.Mesh?'meshDraws':node instanceof three.Line?'lineDraws':'pointsDraws';inventory[kind]+=chargedDraws;
   // These overlap the renderer classes. Direct visibility is not ancestor visibility.
   if(node.userData.sceneSnapshotOverlay===true)inventory.overlayDraws+=chargedDraws;
   if(!node.visible)inventory.directHiddenDraws+=chargedDraws;
   if(Array.isArray(node.material))inventory.multiMaterialDraws+=chargedDraws;
  }
 });if(!Number.isSafeInteger(draws)||!Number.isSafeInteger(triangles))throw Error('WORKSPACE_SCENE_BUDGET');return {draws,triangles};
}
