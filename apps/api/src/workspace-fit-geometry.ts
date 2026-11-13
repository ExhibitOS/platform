// SPDX-License-Identifier: AGPL-3.0-or-later

import type {WorkspaceFitGeometry,WorkspaceFitProfile} from '@exhibitos/studio-contract';
import {modularPortalParts,type ModularPortalFit,type ModularPortalPart,type ModularPortalRole} from '@exhibitos/spec/workspace-fit-models';

type Point = [number, number, number];

const epsilon = 1e-5;
const near = (a:number,b:number) => Math.abs(a-b)<=epsilon;
const metres = (value:number) => Math.round(value*1e6)/1e6;

// Oriented faces of the supported authored cross-sections. Indices refer to
// lexicographically ordered geometric corners, independent of vertex splits,
// accessors, materials, or GLB byte identity.
const ringTriangles = '0,1,3 0,2,4 0,3,2 0,4,18 0,18,20 0,20,1 1,9,11 1,11,3 1,20,21 1,21,9 2,3,23 2,5,4 2,22,5 2,23,22 3,11,15 3,15,23 4,5,6 4,6,16 4,16,18 5,7,6 5,19,7 5,22,19 6,7,8 6,8,12 6,12,16 7,10,8 7,17,10 7,19,17 8,9,13 8,10,9 8,13,12 9,10,11 9,21,13 10,14,11 10,17,14 11,14,15 12,13,15 12,14,16 12,15,14 13,21,23 13,23,15 14,17,16 16,17,18 17,19,18 18,19,20 19,22,20 20,22,21 21,22,23';
// Eight-level 15 mm straight-miter family; independent of source bytes and vertex splits.
const miterRingTriangles = '13,17,16 13,16,12 17,19,18 17,18,16 19,15,14 19,14,18 15,13,12 15,12,14 12,16,20 12,20,10 16,18,21 16,21,20 18,14,11 18,11,21 14,12,10 14,10,11 10,20,22 10,22,8 20,21,23 20,23,22 21,11,9 21,9,23 11,10,8 11,8,9 8,22,24 8,24,6 22,23,25 22,25,24 23,9,7 23,7,25 9,8,6 9,6,7 6,24,26 6,26,4 24,25,27 24,27,26 25,7,5 25,5,27 7,6,4 7,4,5 4,26,28 4,28,0 26,27,30 26,30,28 27,5,2 27,2,30 5,4,0 5,0,2 0,28,29 0,29,1 28,30,31 28,31,29 30,2,3 30,3,31 2,0,1 2,1,3 1,29,17 1,17,13 29,31,19 29,19,17 31,3,15 31,15,19 3,1,13 3,13,15';
const portalTriangles = '0,1,2 0,2,4 0,4,5 0,5,1 1,3,2 1,5,3 2,3,14 2,6,4 2,14,6 3,5,7 3,7,11 3,11,15 3,15,14 4,6,7 4,7,5 6,10,11 6,11,7 6,14,10 8,9,10 8,10,14 8,12,13 8,13,9 8,14,12 9,11,10 9,13,15 9,15,11 12,14,15 12,15,13';

interface Layout {
 bufferView:number;byteOffset?:number;count:number;type:string;componentType:number;
 sparse?:unknown;normalized?:boolean;
}
interface View {buffer:number;byteOffset?:number;byteLength:number;byteStride?:number}

function readAccessor(bin:Buffer,accessor:Layout|undefined,views:View[],positions:boolean,max=256):number[]|undefined {
 if(!accessor||accessor.sparse||accessor.normalized||accessor.count<1||accessor.count>max)return;
 const {componentType,type,count}=accessor, view=views[accessor.bufferView];
 const width=positions?12:componentType===5123?2:componentType===5125?4:componentType===5121?1:0;
 if(!view||view.buffer!==0||!width||(positions?(type!=='VEC3'||componentType!==5126):type!=='SCALAR'))return;
 const offset=(view.byteOffset??0)+(accessor.byteOffset??0),stride=view.byteStride??width;
 const end=offset+(count-1)*stride+width;
 if(offset<(view.byteOffset??0)||stride<width||end>bin.length||end>(view.byteOffset??0)+view.byteLength)return;
 const values:number[]=[];
 for(let i=0;i<count;i++){
  const p=offset+i*stride;
  if(positions)values.push(bin.readFloatLE(p),bin.readFloatLE(p+4),bin.readFloatLE(p+8));
  else values.push(width===4?bin.readUInt32LE(p):width===2?bin.readUInt16LE(p):bin.readUInt8(p));
 }
 return values.every(Number.isFinite)?values:undefined;
}

type Triangle = [number,number,number];
type Face = {normal:Point;offset:number;boundary:Map<string,number>};
const dot=(a:Point,b:Point)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const difference=(a:Point,b:Point):Point=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
function faceNormal(a:Point,b:Point,c:Point):Point|undefined{
 const u=difference(b,a),v=difference(c,a);
 const n:Point=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
 const length=Math.hypot(...n);
 if(length<=1e-10)return;
 return [n[0]/length,n[1]/length,n[2]/length];
}
function addBoundary(edges:Map<string,number>,[a,b,c]:Triangle){
 for(const [start,end] of [[a,b],[b,c],[c,a]] as const){
  const forward=start<end,key=forward?`${start},${end}`:`${end},${start}`;
  const count=(edges.get(key)??0)+(forward?1:-1);
  if(count)edges.set(key,count);else edges.delete(key);
 }
}
function matchesFaces(points:Point[],indices:number[],corners:Point[],faces:string) {
 corners.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
 const mapped=points.map(point=>corners.findIndex(corner=>point.every((n,i)=>near(n,corner[i]!))));
 const expected=faces.split(' ').map(value=>value.split(',').map(Number) as Triangle);
 if(mapped.includes(-1)||new Set(mapped).size!==corners.length||indices.length!==expected.length*3)return false;
 const planes:Face[]=[];
 for(const triangle of expected){
  const [a,b,c]=triangle.map(i=>corners[i]!) as [Point,Point,Point];
  const normal=faceNormal(a,b,c)!;
  const offset=dot(normal,a);
  let plane=planes.find(f=>near(dot(f.normal,normal),1)&&near(f.offset,offset));
  if(!plane){plane={normal,offset,boundary:new Map()};planes.push(plane);}
  addBoundary(plane.boundary,triangle);
 }
 const actual=planes.map(()=>new Map<string,number>());
 for(let i=0;i<indices.length;i+=3){
  const triangle=[mapped[indices[i]!]!,mapped[indices[i+1]!]!,mapped[indices[i+2]!]!] as Triangle;
  const [a,b,c]=triangle.map(i=>corners[i]!) as [Point,Point,Point];
  const normal=faceNormal(a,b,c);
  if(!normal)return false;
  const plane=planes.findIndex(f=>near(dot(f.normal,normal),1)&&[a,b,c].every(point=>near(dot(f.normal,point),f.offset)));
  if(plane<0)return false;
  addBoundary(actual[plane]!,triangle);
 }
 // Positive winding and the same directed planar boundary imply the same
 // coverage, including the portal opening. Internal diagonals cancel.
 return planes.every(({boundary},i)=>boundary.size===actual[i]!.size&&[...boundary].every(([edge,count])=>actual[i]!.get(edge)===count));
}

interface ModularPortalDocument {
 nodes?:{mesh:number;name?:string;translation?:Point}[];
 meshes?:{primitives:{attributes:{POSITION:number;NORMAL?:number};indices:number;mode?:number;targets?:unknown}[]}[];
 scenes?:{nodes:number[]}[];
 scene?:number;
 accessors:Layout[];
 bufferViews:View[];
 textures?:unknown[];
 images?:unknown[];
 animations?:unknown[];
 skins?:unknown[];
 buffers?:unknown[];
}

function closedConvexPart(points:Point[],indices:number[],min:Point,max:Point):boolean {
 const unique:Point[]=[],welded=new Map<string,number>();
 const mapped=points.map(point=>{
  const key=point.map(metres).join(',');
  const prior=welded.get(key);
  if(prior!==undefined)return prior;
  const index=unique.push(point)-1;welded.set(key,index);return index;
 });
 const edges=new Map<string,number>(),edgeCounts=new Map<string,number>();
 let volume=0;
 if(indices.length%3||new Set(indices.map(index=>mapped[index])).size!==unique.length)return false;
 for(let i=0;i<indices.length;i+=3){
  const triangle=[mapped[indices[i]!]!,mapped[indices[i+1]!]!,mapped[indices[i+2]!]!] as Triangle;
  const [a,b,c]=triangle.map(index=>unique[index]!) as [Point,Point,Point];
  const normal=faceNormal(a,b,c);
  // The bevelled author originals have sub-25 micrometre plane variation.
  if(!normal||unique.some(point=>dot(normal,difference(point,a))>2.5e-5))return false;
  const cross:Point=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]];
  volume+=dot(a,cross)/6;
  addBoundary(edges,triangle);
  for(const [from,to]of [[triangle[0],triangle[1]],[triangle[1],triangle[2]],[triangle[2],triangle[0]]]){
   const key=`${Math.min(from!,to!)},${Math.max(from!,to!)}`;
   edgeCounts.set(key,(edgeCounts.get(key)??0)+1);
  }
 }
 const boxVolume=(max[0]-min[0])*(max[1]-min[1])*(max[2]-min[2]);
 return boxVolume>0&&volume>=boxVolume*.94&&volume<=boxVolume*1.0001&&unique.length>=8&&edges.size===0&&[...edgeCounts.values()].every(count=>count===2);
}

function qualifyModularPortal(doc:ModularPortalDocument,bin:Buffer):ModularPortalFit|undefined {
 const nodes=doc.nodes,meshes=doc.meshes,roots=doc.scenes?.[0]?.nodes;
 if(nodes?.length!==9||meshes?.length!==9||doc.scenes?.length!==1||roots?.length!==9||new Set(roots).size!==9||
  roots.some(i=>!Number.isInteger(i)||i<0||i>8)||(doc.scene??0)!==0||new Set(nodes.map(node=>node.mesh)).size!==9||
  doc.textures?.length||doc.images?.length||doc.animations?.length||doc.skins?.length||doc.buffers?.length!==1)return;
 const measured:ModularPortalPart[]=[];
 for(const [index,node]of nodes.entries()){
  const translation=node.translation??[0,0,0],mesh=meshes[node.mesh],primitive=mesh?.primitives[0];
  if(Object.keys(node).some(key=>!['mesh','name','translation'].includes(key))||translation.length!==3||!translation.every(Number.isFinite)||
   mesh?.primitives.length!==1||!primitive||primitive.targets||(primitive.mode??4)!==4)return;
  const positions=readAccessor(bin,doc.accessors[primitive.attributes.POSITION],doc.bufferViews,true,512);
  const normalIndex=primitive.attributes.NORMAL;
  const normals=normalIndex===undefined?undefined:readAccessor(bin,doc.accessors[normalIndex],doc.bufferViews,true,512);
  const indices=readAccessor(bin,doc.accessors[primitive.indices],doc.bufferViews,false,1024);
  if(!positions||!normals||normals.length!==positions.length||!indices||indices.some(i=>i>=positions.length/3))return;
  const points:Point[]=[];
  for(let i=0;i<positions.length;i+=3)points.push([positions[i]!+translation[0],positions[i+1]!+translation[1],positions[i+2]!+translation[2]]);
  const min=[0,1,2].map(axis=>metres(Math.min(...points.map(point=>point[axis]!)))) as Point;
  const max=[0,1,2].map(axis=>metres(Math.max(...points.map(point=>point[axis]!)))) as Point;
  if(!closedConvexPart(points,indices,min,max))return;
  measured.push({node:index,min,max});
 }
 const reveal=measured.filter(({min,max})=>min[2]<0&&max[2]>0);
 const left=reveal.find(({min,max})=>near(min[1],0)&&max[0]<0),right=reveal.find(({min,max})=>near(min[1],0)&&max[0]>0);
 const head=reveal.find(({min,max})=>min[1]>0&&min[0]<0&&max[0]>0);
 if(reveal.length!==3||!left||!right||!head||!near(left.max[0],-right.min[0]))return;
 const minZ=left.min[2],maxZ=left.max[2],openingWidth=metres(right.min[0]-left.max[0]),openingHeight=head.min[1];
 const parts={} as ModularPortalFit['parts'];
 for(const part of measured){
  const {min,max}=part;
  const face=near(min[2],minZ)&&near(max[2],maxZ)?'reveal':near(min[2],maxZ)?'front':near(max[2],minZ)?'back':undefined;
  const side=near(min[1],openingHeight)?'head':max[0]<0?'left':'right';
  if(!face)return;
  const role:ModularPortalRole=`${face}-${side}`;
  if(parts[role])return;
  parts[role]=part;
 }
 const geometry:ModularPortalFit={profile:'modular-portal-v1',openingWidth,openingHeight,minZ,maxZ,parts};
 return modularPortalParts(geometry)?geometry:undefined;
}

/** Call only after the existing worker has fully validated the GLB container.
 * No user metadata, declared bounds, asset hash or filename establishes fit. */
export function qualifyWorkspaceFitGeometry(bytes:Buffer,profile:WorkspaceFitProfile):WorkspaceFitGeometry|undefined {
 const jsonSize=bytes.readUInt32LE(12);
 const doc=JSON.parse(bytes.toString('utf8',20,20+jsonSize));
 const bin=bytes.subarray(28+jsonSize);
 if(profile==='passive-ceiling-rail-v1')return passiveRailBounds(doc,bin);
 if(profile==='modular-portal-v1')return qualifyModularPortal(doc,bin);
 const node=doc.nodes?.[0],primitive=doc.meshes?.[0]?.primitives?.[0];
 if(doc.nodes?.length!==1||doc.meshes?.length!==1||doc.meshes[0].primitives.length!==1||doc.scenes?.length!==1||doc.scenes[0].nodes?.join()!=='0'||(doc.scene??0)!==0||
  node?.mesh!==0||Object.keys(node).some(k=>k!=='mesh'&&k!=='name'&&k!=='extras')||!primitive||primitive.targets||(primitive.mode??4)!==4||
  !(profile==='straight-miter-ring-v1'?Object.keys(primitive.attributes).every(key=>['POSITION','NORMAL','TANGENT','TEXCOORD_0'].includes(key))&&Object.hasOwn(primitive.attributes,'POSITION')&&Object.hasOwn(primitive.attributes,'NORMAL'):Object.keys(primitive.attributes).sort().join(',')==='NORMAL,POSITION')||doc.textures?.length||doc.images?.length||doc.animations?.length||doc.skins?.length||doc.buffers?.length!==1)return;
 const positions=readAccessor(bin,doc.accessors[primitive.attributes.POSITION],doc.bufferViews,true);
 const indices=readAccessor(bin,doc.accessors[primitive.indices],doc.bufferViews,false);
 if(!positions||!indices||indices.some(i=>i>=positions.length/3))return;
 const points:Point[]=[];
 for(let i=0;i<positions.length;i+=3)points.push([positions[i]!,positions[i+1]!,positions[i+2]!]);
 const halfWidth=metres(Math.min(...points.map(([x])=>Math.abs(x))));
 if(profile==='straight-miter-ring-v1'){
  const halfHeight=metres(Math.min(...points.map(([,y])=>Math.abs(y))));
  if(halfWidth<.20||halfWidth>1||halfHeight<.20||halfHeight>1)return;
  const corners:Point[]=[];
  for(const [offset,z] of [[0,0],[0,-.0238],[.0005,-.0246],[.001,-.025],[.014,-.025],[.0147,-.0245],[.015,-.0238],[.015,0]] as const)
   for(const x of [-1,1])for(const y of [-1,1])corners.push([x*(halfWidth+offset),y*(halfHeight+offset),z]);
  if(matchesFaces(points,indices,corners,miterRingTriangles))return {profile,openingWidth:2*halfWidth,openingHeight:2*halfHeight,imagePlaneZ:-.012};
 }else if(profile==='straight-ring-v1'){
  const halfHeight=metres(Math.min(...points.map(([,y])=>Math.abs(y))));
  if(halfWidth<.20||halfWidth>1||halfHeight<.20||halfHeight>1)return;
  const corners:Point[]=[];
  for(const [offset,z] of [[.025,-.0165],[.025,.012],[.0235,-.018],[.0015,-.018],[0,-.0165],[0,.012]] as const)
   for(const x of [-1,1])for(const y of [-1,1])corners.push([x*(halfWidth+offset),y*(halfHeight+offset),z]);
  if(matchesFaces(points,indices,corners,ringTriangles))return {profile,openingWidth:2*halfWidth,openingHeight:2*halfHeight,imagePlaneZ:-.012};
 }else{
  const openingHeight=metres(Math.min(...points.map(([,y])=>y).filter(y=>y>epsilon)));
  const minZ=metres(Math.min(...points.map(([, ,z])=>z))),maxZ=metres(Math.max(...points.map(([, ,z])=>z)));
  if(halfWidth<.45||halfWidth>1.5||openingHeight<2||openingHeight>3.2||minZ<-.15||minZ>-.015||maxZ<.015||maxZ>.15)return;
  const outer=halfWidth+.045,top=openingHeight+.045;
  const outline:Point[]=[[-outer,0,0],[-outer,top,0],[-halfWidth,0,0],[-halfWidth,openingHeight,0],[halfWidth,0,0],[halfWidth,openingHeight,0],[outer,0,0],[outer,top,0]];
  const corners:Point[]=outline.flatMap(([x,y])=>[[x,y,minZ],[x,y,maxZ]] as Point[]);
  if(matchesFaces(points,indices,corners,portalTriangles))return {profile,openingWidth:2*halfWidth,openingHeight,minZ,maxZ};
 }
}

/** Passive visual mount bounds, measured from the default scene's POSITION
 * data after authored transforms. No filename, source hash or accessor min/max
 * is an eligibility test. The existing GLB worker validates the full file first. */
function passiveRailBounds(doc:ReturnType<typeof JSON.parse>,bin:Buffer):WorkspaceFitGeometry|undefined {
 if(doc.animations?.length||doc.skins?.length||!Array.isArray(doc.nodes)||doc.nodes.length>256||!Array.isArray(doc.meshes)||doc.meshes.length>256)return;
 const scene=doc.scenes?.[doc.scene??0];if(!Array.isArray(scene?.nodes)||!scene.nodes.length)return;
 type Matrix=number[];
 const identity=():Matrix=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const multiply=(a:Matrix,b:Matrix):Matrix=>Array.from({length:16},(_,i)=>{const row=i%4,col=Math.floor(i/4);return [0,1,2,3].reduce((sum,k)=>sum+a[k*4+row]!*b[col*4+k]!,0);});
 const local=(node:ReturnType<typeof JSON.parse>):Matrix|undefined=>{
  if(node.matrix!==undefined)return Array.isArray(node.matrix)&&node.matrix.length===16&&node.matrix.every(Number.isFinite)?node.matrix:undefined;
  const t=node.translation??[0,0,0],q=node.rotation??[0,0,0,1],s=node.scale??[1,1,1];
  if(![t,s].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||!Array.isArray(q)||q.length!==4||!q.every(Number.isFinite)||Math.abs(Math.hypot(...q)-1)>1e-5)return;
  const [x,y,z,w]=q;return [(1-2*(y*y+z*z))*s[0],2*(x*y+z*w)*s[0],2*(x*z-y*w)*s[0],0,2*(x*y-z*w)*s[1],(1-2*(x*x+z*z))*s[1],2*(y*z+x*w)*s[1],0,2*(x*z+y*w)*s[2],2*(y*z-x*w)*s[2],(1-2*(x*x+y*y))*s[2],0,t[0],t[1],t[2],1];
 };
 const min:Point=[Infinity,Infinity,Infinity],max:Point=[-Infinity,-Infinity,-Infinity],seen=new Set<number>();let vertices=0,valid=true;
 const visit=(index:number,parent:Matrix)=>{
  if(!Number.isInteger(index)||seen.has(index)||seen.size>=256){valid=false;return;}seen.add(index);
  const node=doc.nodes[index],matrix=node&&local(node);if(!matrix){valid=false;return;}const world=multiply(parent,matrix);
  if(node.mesh!==undefined){const mesh=doc.meshes[node.mesh];if(!Array.isArray(mesh?.primitives)||!mesh.primitives.length){valid=false;return;}
   for(const primitive of mesh.primitives){
    if(primitive.targets||(primitive.mode??4)!==4){valid=false;return;}
    const positions=readAccessor(bin,doc.accessors?.[primitive.attributes?.POSITION],doc.bufferViews??[],true,1000000);
    if(!positions||(vertices+=positions.length/3)>1000000){valid=false;return;}
    for(let i=0;i<positions.length;i+=3)for(let axis=0;axis<3;axis++){
     const p=world[axis]!*positions[i]!+world[4+axis]!*positions[i+1]!+world[8+axis]!*positions[i+2]!+world[12+axis]!;
     if(!Number.isFinite(p)||Math.abs(p)>100){valid=false;return;}min[axis]=Math.min(min[axis]!,p);max[axis]=Math.max(max[axis]!,p);
    }
   }
  }
  if(node.children!==undefined&&!Array.isArray(node.children)){valid=false;return;}
  for(const child of node.children??[])visit(child,world);
 };
 for(const index of scene.nodes)visit(index,identity());
 if(!valid||!vertices||min.some((n,i)=>n>=max[i]!)||Math.abs(max[1])>1e-6||min[1]>=-1e-6||min[0]>0||max[0]<0||min[2]>0||max[2]<0)return;
 return {profile:'passive-ceiling-rail-v1',min:min.map(metres) as Point,max:max.map(metres) as Point};
}
