// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,artifactCorners,artifactBounds,createConvexCollision} from './artifact-affine.js';
import type {AffinePoint} from './artifact-affine.js';
import {INSTALLATION_NAMESPACE,installationBudget,validateStudioInstallation} from './installation.js';
import type {InstallationBinding,InstallationMaterial,StudioInstallation} from './installation.js';
export type InstallationReason='placement-not-found'|'room-mismatch'|'source-not-planar'|'singular-transform'|'missing-room-floor'|'ambiguous-room-floor'|'missing-selected-wall'|'wall-not-parallel'|'limits-exceeded';
export interface InstallationPrimitive {kind:'solid'|'mat';vertices:AffinePoint[];indices:number[];material:InstallationMaterial}
export interface InstallationSolid {vertices:AffinePoint[];indices:number[];collision:ReturnType<typeof createConvexCollision>}
export interface ResolvedInstallation {placementId:string;roomId:string;primitives:InstallationPrimitive[];solids:InstallationSolid[];issues:{component:'frame'|'pedestal';reason:InstallationReason}[]}
const add=(a:AffinePoint,b:AffinePoint):AffinePoint=>a.map((n,i)=>n+b[i]!) as AffinePoint;
const sub=(a:AffinePoint,b:AffinePoint):AffinePoint=>a.map((n,i)=>n-b[i]!) as AffinePoint;
const mul=(a:AffinePoint,t:number):AffinePoint=>a.map(n=>n*t) as AffinePoint;
const dot=(a:AffinePoint,b:AffinePoint)=>a.reduce((s,n,i)=>s+n*b[i]!,0);
const cross=(a:AffinePoint,b:AffinePoint):AffinePoint=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:AffinePoint):AffinePoint=>{const n=Math.hypot(...a);if(!Number.isFinite(n)||n<1e-12)throw Error('singular-transform');return mul(a,1/n);};
const checked=(p:AffinePoint)=>{if(p.some(n=>!Number.isFinite(n)||Math.abs(n)>10000))throw Error('limits-exceeded');return p;};
// Bit-indexed prism corners match the shared affine-hull face convention.
const faces=[[0,2,6,4],[1,5,7,3],[0,4,5,1],[2,3,7,6],[0,1,3,2],[4,6,7,5]];
const prismIndices=faces.flatMap(f=>[f[0]!,f[2]!,f[1]!,f[0]!,f[3]!,f[2]!]);
function prism(quad:AffinePoint[],normal:AffinePoint,back:number,front:number,material:InstallationMaterial):InstallationPrimitive {
 if(front<=back)throw Error('singular-transform');
 const vertices=[back,front].flatMap(z=>[quad[0]!,quad[1]!,quad[3]!,quad[2]!].map(p=>checked(add(p,mul(normal,z)))));
 return {kind:'solid',vertices,indices:[...prismIndices],material:{...material}};
}
/** Offset each affine planar edge by a metric perpendicular distance, then intersect adjacent lines. */
function offsetRing(corners:AffinePoint[],normal:AffinePoint,distance:number):AffinePoint[] {
 const outward=corners.map((p,i)=>mul(unit(cross(normal,unit(sub(corners[(i+1)%4]!,p)))),-1));
 return corners.map((p,i)=>{const a=outward[(i+3)%4]!,b=outward[i]!,den=1+dot(a,b);if(den<1e-10)throw Error('singular-transform');return checked(add(p,mul(add(a,b),distance/den)));});
}
export function installationPlane(artwork:Exhibition['artworks'][number],placement:Exhibition['placements'][number]){
 if(artwork.artworkType!=='image')throw Error('source-not-planar');
 const w=artwork.dimensions.width/2,h=artwork.dimensions.height/2;
 const corners=([[-w,-h,0],[w,-h,0],[w,h,0],[-w,h,0]] as AffinePoint[]).map(p=>artifactPoint(p,artwork.transform,placement.transform));
 const normal=unit(cross(sub(corners[1]!,corners[0]!),sub(corners[3]!,corners[0]!)));
 return {corners,normal};
}
export function installationFramePrimitives(art:Exhibition['artworks'][number],placement:Exhibition['placements'][number],binding:InstallationBinding):InstallationPrimitive[]{
 const f=binding.frame;if(!f||f.kind==='none')return [];
 const {corners,normal}=installationPlane(art,placement),result:InstallationPrimitive[]=[],inner=f.matWidth+f.gap;
 const bars=(start:number,end:number,back:number,front:number)=>{
  if(front===back)return;
  const a=offsetRing(corners,normal,start),b=offsetRing(corners,normal,end);
  for(let i=0;i<4;i++)result.push(prism([a[i]!,b[i]!,b[(i+1)%4]!,a[(i+1)%4]!],normal,back,front,f.material));
 };
 if(f.kind==='stepped'){bars(inner,inner+f.borderWidth,-f.thickness,f.depth/2);if(f.depth>0)bars(inner+f.borderWidth/2,inner+f.borderWidth,f.depth/2,f.depth);}
 else bars(inner,inner+f.borderWidth,-f.thickness,f.depth);
 if(f.matWidth>0){const ring=offsetRing(corners,normal,f.matWidth),material:InstallationMaterial={preset:'paint',color:f.matColor,roughness:1,metalness:0};for(let i=0;i<4;i++)result.push({kind:'mat',vertices:[corners[i]!,ring[i]!,ring[(i+1)%4]!,corners[(i+1)%4]!].map(p=>checked(add(p,mul(normal,-.001)))),indices:[0,1,2,0,2,3],material:{...material}});}
 return result;
}
function pedestalPrimitive(binding:InstallationBinding):InstallationPrimitive[] {
 const p=binding.pedestal;if(!p||p.kind==='none')return [];
 const rotation:[number,number,number,number]=[0,Math.sin(p.yaw/2),0,Math.cos(p.yaw/2)],transform={position:p.position,rotation,scale:[1,1,1] as AffinePoint};
 if(p.kind==='box'){
  const center={...transform,position:add(p.position,[0,p.dimensions.height/2,0])};return [{kind:'solid',vertices:artifactCorners(p.dimensions,[center]),indices:[...prismIndices],material:{...p.material}}];
 }
 const radius=p.dimensions.diameter/2,vertices:AffinePoint[]=[],indices:number[]=[];
 for(const y of [0,p.dimensions.height])for(let i=0;i<32;i++)vertices.push(artifactPoint([radius*Math.cos(i*Math.PI/16),y,radius*Math.sin(i*Math.PI/16)],transform));
 // Each cap uses a bounded fan with existing rim vertex; no extra center vertex.
 for(let i=0;i<32;i++){const j=(i+1)%32;indices.push(i,j,32+j,i,32+j,32+i);}
 for(let i=1;i<31;i++){indices.push(0,i+1,i,32,32+i,32+i+1);}
 for(let i=0;i<indices.length;i+=3){const b=indices[i+1]!;indices[i+1]=indices[i+2]!;indices[i+2]=b;}
 return [{kind:'solid',vertices,indices,material:{...p.material}}];
}
/** Pure room-local projection. All allocations follow the shared preflight material/primitive budgets. */
export function resolveInstallations(candidate:Exhibition):ResolvedInstallation[]{
 if(!validateStudioInstallation(candidate).valid)throw Error('INSTALLATION_PROFILE_INVALID');
 const value=candidate.extensions?.[INSTALLATION_NAMESPACE] as StudioInstallation|undefined;if(!value)return [];
 installationBudget(value.placements);
 return value.placements.map(binding=>resolveBinding(candidate,binding));
}
/** Single placement preview uses the same projection/admission without rebuilding unrelated geometry. */
export function resolveInstallation(candidate:Exhibition,placementId:string):ResolvedInstallation|undefined{
 if(!validateStudioInstallation(candidate).valid)throw Error('INSTALLATION_PROFILE_INVALID');
 const value=candidate.extensions?.[INSTALLATION_NAMESPACE] as StudioInstallation|undefined;if(!value)return undefined;
 installationBudget(value.placements);const binding=value.placements.find(b=>b.placementId.toLowerCase()===placementId.toLowerCase());return binding?resolveBinding(candidate,binding):undefined;
}
function resolveBinding(candidate:Exhibition,binding:InstallationBinding):ResolvedInstallation{
 const placement=candidate.placements.find(p=>p.id.toLowerCase()===binding.placementId.toLowerCase());if(!placement)throw Error('INSTALLATION_REFERENCE');
 const art=candidate.artworks.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase()),room=candidate.rooms.find(r=>r.id.toLowerCase()===placement.roomId.toLowerCase());if(!art||!room)throw Error('INSTALLATION_REFERENCE');
 const result:ResolvedInstallation={placementId:placement.id,roomId:placement.roomId,primitives:[],solids:[],issues:[]};
 for(const component of ['pedestal','frame'] as const)try{
  const primitives=component==='pedestal'?pedestalPrimitive(binding):installationFramePrimitives(art,placement,binding),solids:InstallationSolid[]=[];
  // Both local GPU positions and world Float32 physics positions must remain nondegenerate.
  // A failed component is omitted consistently from rendering, Rapier and presence; source metadata stays intact.
  for(const primitive of primitives){
   let vertices:AffinePoint[];try{vertices=primitive.vertices.map(v=>artifactPoint(v,room.transform));}catch(error){throw Error('limits-exceeded',{cause:error});}
   if(primitive.kind==='solid'){createConvexCollision(primitive.vertices,primitive.indices);solids.push({vertices,indices:[...primitive.indices],collision:createConvexCollision(vertices,primitive.indices)});}
   else for(const points of [primitive.vertices,vertices])for(const ps of [points,points.map(p=>p.map(Math.fround) as AffinePoint)])for(let i=0;i<primitive.indices.length;i+=3){const [a,b,c]=primitive.indices.slice(i,i+3).map(j=>ps[j]!);if(!(Math.hypot(...cross(sub(b!,a!),sub(c!,a!)))>1e-12))throw Error('singular-transform');}
  }
  result.primitives.push(...primitives);result.solids.push(...solids);
 }catch(error){const message=error instanceof Error?error.message:'';result.issues.push({component,reason:message==='source-not-planar'?'source-not-planar':message==='limits-exceeded'||component==='pedestal'&&message==='ARTIFACT_AFFINE_UNSUPPORTED'?'limits-exceeded':'singular-transform'});}
 return result;
}

/** Room-local artwork assertion bounds, unaffected by decoration or LOD choice. */
export function installationArtworkBounds(art:Exhibition['artworks'][number],placement:Exhibition['placements'][number]){return artifactBounds(artifactCorners(art.dimensions,[art.transform,placement.transform]));}
