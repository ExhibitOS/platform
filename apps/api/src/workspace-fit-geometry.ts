// SPDX-License-Identifier: AGPL-3.0-or-later

type Point = [number, number, number];
export type WorkspaceFitProfile = 'straight-ring-v1' | 'continuous-portal-v1';

export type WorkspaceFitGeometry =
 | {profile:'straight-ring-v1';openingWidth:number;openingHeight:number;imagePlaneZ:number}
 | {profile:'continuous-portal-v1';openingWidth:number;openingHeight:number;minZ:number;maxZ:number};

const epsilon = 1e-5;
const near = (a:number,b:number) => Math.abs(a-b)<=epsilon;
const metres = (value:number) => Math.round(value*1e6)/1e6;

// Oriented faces of the supported authored cross-sections. Indices refer to
// lexicographically ordered geometric corners, independent of vertex splits,
// accessors, materials, or GLB byte identity.
const ringTriangles = '0,1,3 0,2,4 0,3,2 0,4,18 0,18,20 0,20,1 1,9,11 1,11,3 1,20,21 1,21,9 2,3,23 2,5,4 2,22,5 2,23,22 3,11,15 3,15,23 4,5,6 4,6,16 4,16,18 5,7,6 5,19,7 5,22,19 6,7,8 6,8,12 6,12,16 7,10,8 7,17,10 7,19,17 8,9,13 8,10,9 8,13,12 9,10,11 9,21,13 10,14,11 10,17,14 11,14,15 12,13,15 12,14,16 12,15,14 13,21,23 13,23,15 14,17,16 16,17,18 17,19,18 18,19,20 19,22,20 20,22,21 21,22,23';
const portalTriangles = '0,1,2 0,2,4 0,4,5 0,5,1 1,3,2 1,5,3 2,3,14 2,6,4 2,14,6 3,5,7 3,7,11 3,11,15 3,15,14 4,6,7 4,7,5 6,10,11 6,11,7 6,14,10 8,9,10 8,10,14 8,12,13 8,13,9 8,14,12 9,11,10 9,13,15 9,15,11 12,14,15 12,15,13';

interface Layout {
 bufferView:number;byteOffset?:number;count:number;type:string;componentType:number;
 sparse?:unknown;normalized?:boolean;
}
interface View {buffer:number;byteOffset?:number;byteLength:number;byteStride?:number}

function readAccessor(bin:Buffer,accessor:Layout|undefined,views:View[],positions:boolean):number[]|undefined {
 if(!accessor||accessor.sparse||accessor.normalized||accessor.count<1||accessor.count>256)return;
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

function matchesFaces(points:Point[],indices:number[],corners:Point[],faces:string) {
 corners.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
 const mapped=points.map(point=>corners.findIndex(corner=>point.every((n,i)=>near(n,corner[i]!))));
 if(mapped.includes(-1)||new Set(mapped).size!==corners.length||indices.length%3!==0)return false;
 const expected=new Set(faces.split(' '));
 for(let i=0;i<indices.length;i+=3){
  const a=mapped[indices[i]!]!,b=mapped[indices[i+1]!]!,c=mapped[indices[i+2]!]!;
  const face=a<b&&a<c?[a,b,c]:b<c?[b,c,a]:[c,a,b];
  if(!expected.delete(face.join(',')))return false;
 }
 return expected.size===0;
}

/** Call only after the existing worker has fully validated the GLB container.
 * No user metadata, declared bounds, asset hash or filename establishes fit. */
export function qualifyWorkspaceFitGeometry(bytes:Buffer,profile:WorkspaceFitProfile):WorkspaceFitGeometry|undefined {
 const jsonSize=bytes.readUInt32LE(12);
 const doc=JSON.parse(bytes.toString('utf8',20,20+jsonSize));
 const node=doc.nodes?.[0],primitive=doc.meshes?.[0]?.primitives?.[0];
 if(doc.nodes?.length!==1||doc.meshes?.length!==1||doc.meshes[0].primitives.length!==1||doc.scenes?.length!==1||doc.scenes[0].nodes?.join()!=='0'||(doc.scene??0)!==0||
  node?.mesh!==0||Object.keys(node).some(k=>k!=='mesh'&&k!=='name'&&k!=='extras')||!primitive||primitive.targets||(primitive.mode??4)!==4||
  Object.keys(primitive.attributes).sort().join(',')!=='NORMAL,POSITION'||doc.textures?.length||doc.images?.length||doc.animations?.length||doc.skins?.length||doc.buffers?.length!==1)return;
 const bin=bytes.subarray(28+jsonSize);
 const positions=readAccessor(bin,doc.accessors[primitive.attributes.POSITION],doc.bufferViews,true);
 const indices=readAccessor(bin,doc.accessors[primitive.indices],doc.bufferViews,false);
 if(!positions||!indices||indices.some(i=>i>=positions.length/3))return;
 const points:Point[]=[];
 for(let i=0;i<positions.length;i+=3)points.push([positions[i]!,positions[i+1]!,positions[i+2]!]);
 const halfWidth=metres(Math.min(...points.map(([x])=>Math.abs(x))));
 if(profile==='straight-ring-v1'){
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
