// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {BENCH_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/studio-contract';
import {DEVICE_BUDGETS} from '../viewer/loading';
import {createOwnerFurnishingScene} from './owner-scene';
import {loadWorkspaceFurnishingModel} from './model-loader';
vi.mock('./model-loader',()=>({loadWorkspaceFurnishingModel:vi.fn()}));
afterEach(()=>vi.clearAllMocks());
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it.each([['positive-z',true],['negative-z',false],[undefined,false]] as const)('admits the linked seat only after its declared model basis passes actual geometry fit (%s)',async(modelForward,ready)=>{
 const object=new three.Group(),geometry=new three.BoxGeometry(1,1,1),material=new three.MeshBasicMaterial();
 for(const [size,point] of [[[1.5,.06,.56],[0,.42,0]],[[1.4,.15,.05],[0,.745,-.28]],[[.06,.39,.06],[-.55,.195,-.20]],[[.06,.39,.06],[.55,.195,.20]]] as const){const mesh=new three.Mesh(geometry,material);mesh.scale.fromArray(size);mesh.position.fromArray(point);object.add(mesh);}
 const dispose=vi.fn(()=>object.removeFromParent());vi.mocked(loadWorkspaceFurnishingModel).mockResolvedValue({object,dispose,draws:4,triangles:48,reserveBytes:1});
 const roomId=id(1),placementId=id(3),hash='a'.repeat(64),link={placementId,modelSha256:hash,...(modelForward?{modelForward}:{})},position:[number,number,number]=[1,0,2];
 const descriptor={id:id(2),version:1,kind:'bench',name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:100,sha256:hash}};
 const candidate={rooms:[{id:roomId,dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:1,furnishings:[descriptor],placements:[{id:placementId,roomId,furnishingId:descriptor.id,furnishingVersion:1,position,yaw:.4,scale:1}]},[BENCH_NAMESPACE]:{version:1,benches:[{id:id(5),roomId,name:'Seat',position,yaw:.4,kind:'backed',dimensions:{width:1.5,depth:.7,height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId:id(6),workspaceVisual:link}]}}};
 const scene=new three.Scene(),room=new three.Group();scene.add(room);const check=async()=>{},runtime=createOwnerFurnishingScene({three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[roomId,room]]),candidate,tenantId:id(9),signal:new AbortController().signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,transitionBytes:64*1024*1024,resident:()=>0,changed:()=>{},modelSource:()=>({check,open:vi.fn()}),publicAuthority:{check,valid:()=>true}});
 try{
  expect(await runtime.start()).toEqual({loaded:ready?1:0,failed:ready?0:1});expect(runtime.seatAvailability(link)).toBe(ready?'ready':'unavailable');
  expect(runtime.seatVisuals().size).toBe(ready?1:0);expect(room.children).toHaveLength(ready?1:0);
  if(ready){const visual=runtime.seatVisuals().get(placementId)!;expect(visual).toBe(room.children[0]);expect(visual.position.toArray()).toEqual(position);expect(visual.rotation.y).toBe(.4);expect(object.position.toArray()).toEqual([0,0,0]);}
 }finally{runtime.dispose();expect(room.children).toHaveLength(0);expect(dispose).toHaveBeenCalledOnce();geometry.dispose();material.dispose();}
});
