// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import * as three from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings} from '@exhibitos/studio-contract';
import {AssetPeakBudget,DEVICE_BUDGETS} from '../viewer/loading';
import {mountOwnerWorkspacePlacement} from './owner-placement';
import {loadWorkspaceFurnishingModel} from './model-loader';
import {ownerWorkspaceModelSource} from './owner-source';
import {OwnerPreviewBudget} from './owner-preview-budget';

vi.mock('./model-loader',()=>({loadWorkspaceFurnishingModel:vi.fn()}));
vi.mock('./owner-source',()=>({ownerWorkspaceModelSource:vi.fn()}));
afterEach(()=>vi.clearAllMocks());
const id=(n:number)=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const originalHash='4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4';
const original=()=>readFile(new URL('../../../api/test-fixtures/thin-brass-frame/model.glb',import.meta.url));
const pose=(position:[number,number,number],rotation:three.Quaternion)=>({
  position,rotation:rotation.toArray() as [number,number,number,number],scale:[1,1,1] as [number,number,number],
});
const roomRotation=new three.Quaternion().setFromEuler(new three.Euler(0,.35,0));
const placementRotation=new three.Quaternion().setFromEuler(new three.Euler(.1,.2,-.05));
const artRotation=new three.Quaternion().setFromEuler(new three.Euler(-.03,.04,.02));

async function decoded(bytes:Buffer){
  const data=new ArrayBuffer(bytes.length);new Uint8Array(data).set(bytes);
  return (await new GLTFLoader().parseAsync(data,'')).scene;
}
function firstMesh(object:three.Object3D){
  let found:three.Mesh|undefined;
  object.traverse(node=>{if(!found&&node instanceof three.Mesh)found=node;});
  if(!found)throw Error('FIXTURE_MESH_MISSING');
  return found;
}
// This is a synthetic legacy six-level section, not an issued fit or source approval.
function legacyRing(){
  const positions:number[]=[],indices:number[]=[];
  const section=[[.025,-.0165],[.025,.012],[.0235,-.018],[.0015,-.018],[0,-.0165],[0,.012]];
  for(const [offset,z] of section)for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]])
    positions.push(x!*(.3+offset!),y!*(.4+offset!),z!);
  for(let level=0;level<section.length;level++)for(let side=0;side<4;side++){
    const a=level*4+side,b=level*4+(side+1)%4,c=((level+1)%section.length)*4+side,d=((level+1)%section.length)*4+(side+1)%4;
    indices.push(a,b,c,b,d,c);
  }
  const geometry=new three.BufferGeometry();
  geometry.setAttribute('position',new three.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const object=new three.Group();object.add(new three.Mesh(geometry,new three.MeshStandardMaterial({color:0x584634})));return object;
}
async function fixture(width:number,height:number,profile:'straight-miter-ring-v1'|'straight-ring-v1'='straight-miter-ring-v1',bytes?:Buffer){
  const input=bytes??await original(),object=profile==='straight-miter-ring-v1'?await decoded(input):legacyRing();
  const mesh=firstMesh(object),geometry=mesh.geometry as three.BufferGeometry;
  const sha=profile==='straight-miter-ring-v1'?createHash('sha256').update(input).digest('hex'):'b'.repeat(64);
  const model={mime:'model/gltf-binary' as const,bytes:profile==='straight-miter-ring-v1'?input.length:100,sha256:sha};
  const descriptor={id:id(2),version:1 as const,kind:'artwork-frame' as const,name:'Synthetic frame renderer target',
    rights:{permissions:{display:true}},provenance:'CC0 fixture or synthetic legacy geometry; not live owner adoption',model,
    fit:{version:1 as const,sourceSha256:sha,sourceBytes:model.bytes,geometry:{profile,openingWidth:.6,openingHeight:.8,imagePlaneZ:-.012}}};
  const attachment={placementId:id(4),artworkRevisionId:id(5),assetId:id(6),furnishingId:id(2),furnishingVersion:1 as const,modelSha256:sha};
  const roomPose=pose([3,0,-4],roomRotation),placementPose=pose([1,1.5,-2],placementRotation),artPose=pose([.01,-.02,.003],artRotation);
  const candidate={rooms:[{id:id(1),dimensions:{width:8,height:4,depth:8},transform:roomPose}],
    placements:[{id:id(4),roomId:id(1),artworkRevisionId:id(5),assetId:id(6),transform:placementPose}],
    artworks:[{revisionId:id(5),primaryAssetId:id(6),schemaVersion:'1.0.0-draft.1',artworkType:'image',dimensions:{width,height},transform:artPose}],
    extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:profile==='straight-miter-ring-v1'?9:7,furnishings:[descriptor],placements:[],frameAttachments:[attachment],openingAttachments:[]}}};
  const room=new three.Group();room.position.fromArray(roomPose.position);room.quaternion.copy(roomRotation);
  const controller=new AbortController(),dispose=vi.fn(()=>object.removeFromParent()),check=vi.fn(async()=>{});
  vi.mocked(ownerWorkspaceModelSource).mockReturnValue({check,open:vi.fn()});
  vi.mocked(loadWorkspaceFurnishingModel).mockResolvedValue({object,dispose,draws:1,triangles:geometry.index!.count/3,reserveBytes:input.length});
  const options={three,renderer:{} as three.WebGLRenderer,candidate,scope:new OwnerPreviewBudget(id(7),fetch,256,100000),
    roomId:id(1),placementId:id(4),frameAttachment:attachment,room,signal:controller.signal,unavailable:()=>false,
    budget:DEVICE_BUDGETS.desktop,ledger:new AssetPeakBudget(32*1024*1024,()=>0),onRevoked:vi.fn(),sceneManagedAuthority:true};
  const cleanup=()=>object.traverse(node=>{if(node instanceof three.Mesh){node.geometry.dispose();for(const material of Array.isArray(node.material)?node.material:[node.material])material.dispose();}});
  return {input,object,mesh,geometry,descriptor,candidate,attachment,room,options,dispose,cleanup};
}
function sectionSignature(geometry:three.BufferGeometry,openingWidth:number,openingHeight:number){
  const points=geometry.getAttribute('position'),rows=new Set<string>();
  for(let i=0;i<points.count;i++)rows.add([Math.abs(points.getX(i))-openingWidth/2,Math.abs(points.getY(i))-openingHeight/2,points.getZ(i)].map(n=>(Math.round(n*1e6)/1e6).toFixed(6)).join(','));
  return [...rows].sort();
}
function attributeBytes(geometry:three.BufferGeometry){
  return Object.fromEntries(Object.keys(geometry.attributes).filter(name=>name!=='position').map(name=>[name,Array.from(geometry.getAttribute(name).array)]));
}

it.each([[.934,.732],[1.365,1.435]])('fits the unchanged eight-level brass original to %s×%s with rigid anchors and original finish',async(width,height)=>{
  const f=await fixture(width,height),source=Buffer.from(f.input),attributes=attributeBytes(f.geometry),index=Array.from(f.geometry.index!.array),
    material=f.mesh.material as three.MeshStandardMaterial,finish=material.toJSON(),section=sectionSignature(f.geometry,.6,.8);
  expect(createHash('sha256').update(source).digest('hex')).toBe(originalHash);expect(section).toHaveLength(8);
  expect(Object.keys(attributes).sort()).toEqual(['normal','tangent','uv']);
  expect(validateWorkspaceFurnishings(f.candidate).valid).toBe(true);
  try{
    const mounted=await mountOwnerWorkspacePlacement(f.options);
    f.geometry.computeBoundingBox();const bounds=f.geometry.boundingBox!,size=bounds.getSize(new three.Vector3());
    expect(size.x).toBeCloseTo(width+.006+.03,5);expect(size.y).toBeCloseTo(height+.006+.03,5);
    expect(sectionSignature(f.geometry,width+.006,height+.006)).toEqual(section);
    expect(attributeBytes(f.geometry)).toEqual(attributes);expect(Array.from(f.geometry.index!.array)).toEqual(index);
    expect(f.mesh.material).toBe(material);expect(material.toJSON()).toEqual(finish);expect(f.object.scale.toArray()).toEqual([1,1,1]);
    f.room.updateMatrixWorld(true);
    const expected=new three.Vector3(.01,-.02,.003).applyQuaternion(placementRotation).add(new three.Vector3(1,1.5,-2)).applyQuaternion(roomRotation).add(new three.Vector3(3,0,-4));
    const imagePlane=new three.Vector3(0,0,-.012).applyMatrix4(f.object.matrixWorld);
    expect(imagePlane.distanceTo(expected)).toBeLessThan(1e-9);
    const front=new three.Vector3(0,0,1).applyQuaternion(artRotation).applyQuaternion(placementRotation).applyQuaternion(roomRotation);
    expect(new three.Vector3(0,0,-1).transformDirection(f.object.matrixWorld).distanceTo(front)).toBeLessThan(1e-9);
    expect(new three.Vector3().applyMatrix4(f.object.matrixWorld).sub(expected).dot(front)).toBeCloseTo(-.012,9);
    expect(f.object.matrixWorld.determinant()).toBeCloseTo(1,9);expect(f.object.matrixAutoUpdate).toBe(false);
    expect(f.input).toEqual(source);mounted.dispose();expect(f.object.parent).toBeNull();expect(f.dispose).toHaveBeenCalledOnce();
  }finally{f.cleanup();}
});
it('fits the same supported section without a source-hash or material-name rendering allowlist',async()=>{
  const originalBytes=await original(),length=originalBytes.readUInt32LE(12),doc=JSON.parse(originalBytes.toString('utf8',20,20+length));
  doc.materials[0].name='Synthetic alternative finish';
  const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
  const header=Buffer.from(originalBytes.subarray(0,20)),tail=originalBytes.subarray(20+length);
  header.writeUInt32LE(20+padded.length+tail.length,8);header.writeUInt32LE(padded.length,12);
  const f=await fixture(.934,.732,'straight-miter-ring-v1',Buffer.concat([header,padded,tail]));
  expect(f.descriptor.model.sha256).not.toBe(originalHash);
  try{const mounted=await mountOwnerWorkspacePlacement(f.options);expect((f.mesh.material as three.Material).name).toBe('Synthetic alternative finish');mounted.dispose();}
  finally{f.cleanup();}
});
it('retains measured legacy six-level ring fitting and its section',async()=>{
  const f=await fixture(.934,.732,'straight-ring-v1'),section=sectionSignature(f.geometry,.6,.8);
  expect(section).toHaveLength(6);
  try{const mounted=await mountOwnerWorkspacePlacement(f.options);expect(sectionSignature(f.geometry,.94,.738)).toEqual(section);mounted.dispose();}
  finally{f.cleanup();}
});
it.each(['source-binding','stale-target','unsupported-size','non-rigid-scale'] as const)('keeps %s rejected before loading a new-family model',async(kind)=>{
  const f=await fixture(.934,.732);
  if(kind==='source-binding')f.descriptor.fit.sourceBytes++;
  if(kind==='stale-target')f.candidate.placements[0]!.artworkRevisionId=id(99);
  if(kind==='unsupported-size')f.candidate.artworks[0]!.dimensions.width=.399;
  if(kind==='non-rigid-scale')f.candidate.artworks[0]!.transform.scale[0]=1.01;
  try{await expect(mountOwnerWorkspacePlacement(f.options)).rejects.toThrow('WORKSPACE_PLACEMENT_INVALID');expect(loadWorkspaceFurnishingModel).not.toHaveBeenCalled();}
  finally{f.cleanup();}
});
it('retains display authority before any new-family geometry work',async()=>{
  const f=await fixture(.934,.732);f.descriptor.rights.permissions.display=false;
  try{await expect(mountOwnerWorkspacePlacement(f.options)).rejects.toThrow('WORKSPACE_MODEL_AUTHORITY');expect(loadWorkspaceFurnishingModel).not.toHaveBeenCalled();}
  finally{f.cleanup();}
});
