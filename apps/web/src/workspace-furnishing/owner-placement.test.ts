// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/studio-contract';
import {AssetPeakBudget,DEVICE_BUDGETS} from '../viewer/loading';
import {mountOwnerWorkspacePlacement} from './owner-placement';
import {loadWorkspaceFurnishingModel} from './model-loader';
import {ownerWorkspaceModelSource} from './owner-source';
import {OwnerPreviewBudget} from './owner-preview-budget';
vi.mock('./model-loader',()=>({loadWorkspaceFurnishingModel:vi.fn()}));
vi.mock('./owner-source',()=>({ownerWorkspaceModelSource:vi.fn()}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(){const object=new three.Group(),dispose=vi.fn(()=>object.removeFromParent()),check=vi.fn(async()=>{}),onRevoked=vi.fn(),room=new three.Group(),controller=new AbortController(),furnishing={id:id(2),version:1,kind:'bench',name:'Bench',rights:{permissions:{display:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:100,sha256:'a'.repeat(64)}},placement={id:id(3),roomId:id(1),furnishingId:id(2),furnishingVersion:1,position:[1,0,2],yaw:.5,scale:1.5},candidate={rooms:[{id:id(1),dimensions:{width:8,height:3,depth:8}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:1,furnishings:[furnishing],placements:[placement]}}};vi.mocked(ownerWorkspaceModelSource).mockReturnValue({check,open:vi.fn()});vi.mocked(loadWorkspaceFurnishingModel).mockResolvedValue({object,dispose,draws:1,triangles:1,reserveBytes:1});return {object,dispose,check,onRevoked,room,controller,options:{three,renderer:{} as three.WebGLRenderer,candidate,scope:new OwnerPreviewBudget(id(4),fetch,256,100000),roomId:id(1),placementId:id(3),room,signal:controller.signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,ledger:new AssetPeakBudget(1024,()=>0),onRevoked}};}
it('places the registered room-local pose and removes it when a later authority check fails',async()=>{vi.useFakeTimers();const f=setup(),mounted=await mountOwnerWorkspacePlacement(f.options);expect(f.room.children).toContain(f.object);expect(f.object.position.toArray()).toEqual([1,0,2]);expect(f.object.rotation.y).toBe(.5);expect(f.object.scale.x).toBe(1.5);f.check.mockRejectedValueOnce(Error('OWNER_REVOKED'));await vi.advanceTimersByTimeAsync(5000);expect(f.room.children).not.toContain(f.object);expect(f.dispose).toHaveBeenCalledOnce();expect(f.onRevoked).toHaveBeenCalledOnce();mounted.dispose();expect(f.dispose).toHaveBeenCalledOnce();});
it('hides the placement while authority is pending and restores it only on success',async()=>{vi.useFakeTimers();const f=setup();let finish!:()=>void;f.check.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));const mounted=await mountOwnerWorkspacePlacement(f.options);await vi.advanceTimersByTimeAsync(5000);expect(f.object.visible).toBe(false);finish();await vi.advanceTimersByTimeAsync(0);expect(f.object.visible).toBe(true);mounted.dispose();});
it('rejects another room and disposes immediately on teardown',async()=>{const f=setup();await expect(mountOwnerWorkspacePlacement({...f.options,roomId:id(9)})).rejects.toThrow('WORKSPACE_PLACEMENT_INVALID');expect(loadWorkspaceFurnishingModel).not.toHaveBeenCalled();await mountOwnerWorkspacePlacement(f.options);f.controller.abort();expect(f.dispose).toHaveBeenCalledOnce();expect(f.room.children).toHaveLength(0);});
it('never restores a model after the display grant expires during an authority check',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));const f=setup(),item=f.options.candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE].furnishings[0]!;Object.assign(item.rights,{expiresAt:'2026-01-01T00:00:06Z'});let finish!:()=>void;f.check.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await mountOwnerWorkspacePlacement(f.options);await vi.advanceTimersByTimeAsync(5000);expect(f.object.visible).toBe(false);await vi.advanceTimersByTimeAsync(1000);expect(f.dispose).toHaveBeenCalledOnce();finish();await vi.runAllTicks();expect(f.object.visible).toBe(false);});
it('enforces expiry after a throttled timer when rendering resumes',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));const f=setup(),item=f.options.candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE].furnishings[0]!;Object.assign(item.rights,{expiresAt:'2026-01-01T00:00:01Z'});const mounted=await mountOwnerWorkspacePlacement(f.options);vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));expect(mounted.enforce()).toBe(false);expect(f.object.visible).toBe(false);expect(f.dispose).toHaveBeenCalledOnce();});
it('aborts its own pending authority request on disposal without aborting the parent',async()=>{vi.useFakeTimers();const f=setup();f.check.mockImplementationOnce(()=>new Promise(()=>{}));const mounted=await mountOwnerWorkspacePlacement(f.options),local=vi.mocked(ownerWorkspaceModelSource).mock.calls[0]![2];await vi.advanceTimersByTimeAsync(5000);mounted.dispose();expect(local.aborted).toBe(true);expect(f.controller.signal.aborted).toBe(false);expect(f.dispose).toHaveBeenCalledOnce();});
it('stays hidden when a predicate, cleanup or notification throws',async()=>{vi.useFakeTimers();const f=setup();let failed=false;f.options.unavailable=()=>{if(failed)throw Error('PREDICATE');return false;};f.dispose.mockImplementation(()=>{throw Error('CLEANUP');});f.onRevoked.mockImplementation(()=>{throw Error('NOTIFY');});await mountOwnerWorkspacePlacement(f.options);failed=true;await vi.advanceTimersByTimeAsync(5000);expect(f.object.visible).toBe(false);expect(f.dispose).toHaveBeenCalledOnce();expect(f.onRevoked).toHaveBeenCalledOnce();});
it('fails closed when authority check throws synchronously',async()=>{vi.useFakeTimers();const f=setup();f.check.mockImplementationOnce(()=>{throw Error('WORKSPACE_AUTHORITY_DRAINING');});await mountOwnerWorkspacePlacement(f.options);await vi.advanceTimersByTimeAsync(5000);expect(f.dispose).toHaveBeenCalledOnce();expect(f.object.visible).toBe(false);expect(f.onRevoked).toHaveBeenCalledOnce();});
it('does not install a live mount if the parent aborts during room attachment',async()=>{vi.useFakeTimers();const f=setup();f.object.addEventListener('added',()=>f.controller.abort());await expect(mountOwnerWorkspacePlacement(f.options)).rejects.toThrow();expect(f.dispose).toHaveBeenCalledOnce();expect(f.room.children).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);});
it('removes the parent abort listener if authority source setup throws',async()=>{const f=setup(),remove=vi.spyOn(f.controller.signal,'removeEventListener');vi.mocked(ownerWorkspaceModelSource).mockImplementationOnce(()=>{throw Error('BAD_SCOPE');});await expect(mountOwnerWorkspacePlacement(f.options)).rejects.toThrow('BAD_SCOPE');expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));expect(loadWorkspaceFurnishingModel).not.toHaveBeenCalled();});
it('mounts a v2 stool at its room-local pose',async()=>{
 const f=setup(),extension=f.options.candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE];extension.version=2;extension.furnishings[0]!.kind='stool';
 const mounted=await mountOwnerWorkspacePlacement(f.options);
 expect(f.room.children).toContain(f.object);expect(f.object.position.toArray()).toEqual([1,0,2]);expect(f.object.rotation.y).toBe(.5);expect(f.object.scale.x).toBe(1.5);
 mounted.dispose();expect(f.room.children).toHaveLength(0);
});
it('mounts the fixed portal at the authoritative wall-local door bottom',async()=>{
 const f=setup(),sha='385a3a6d5266a5dda5b3fc6e51fd14e0b990e29de66ee27a80b634a93ef2591b',pose={position:[2,1.5,-4],rotation:[0,0,0,1],scale:[1,1,1]},attachment={openingId:id(5),furnishingId:id(2),furnishingVersion:1 as const,modelSha256:sha};
 const candidate={rooms:[{id:id(1),dimensions:{width:8,height:3,depth:8},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}}],surfaces:[{id:id(4),roomId:id(1),type:'wall',transform:pose}],openings:[{id:id(5),surfaceId:id(4),type:'door',dimensions:{width:2.4,height:2.6},offset:[1,-.2]}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:6,furnishings:[{id:id(2),version:1,kind:'portal-finish',name:'Portal',rights:{permissions:{display:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:164044,sha256:sha}}],placements:[],frameAttachments:[],openingAttachments:[attachment]}}};
 const mounted=await mountOwnerWorkspacePlacement({...f.options,candidate,placementId:id(5),openingAttachment:attachment});expect(f.object.matrixAutoUpdate).toBe(false);expect(new three.Vector3().setFromMatrixPosition(f.object.matrix).toArray()).toEqual([3,0,-4]);mounted.dispose();
});

it('mounts both measured continuous portal sizes at the wall-local door bottom',async()=>{
 for(const [width,height,depth] of [[2.4,2.6,.2],[1.4,2.2,.12]] as const){
  const f=setup(),sha='a'.repeat(64),pose={position:[2,1.5,-4],rotation:[0,0,0,1],scale:[1,1,1]},attachment={openingId:id(5),furnishingId:id(2),furnishingVersion:1 as const,modelSha256:sha};
  const descriptor={id:id(2),version:1,kind:'portal-finish',name:'Portal',rights:{permissions:{display:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:100,sha256:sha},fit:{version:1,sourceSha256:sha,sourceBytes:100,geometry:{profile:'continuous-portal-v1',openingWidth:width,openingHeight:height,minZ:-depth/2,maxZ:depth/2}}};
  const candidate={rooms:[{id:id(1),dimensions:{width:8,height:3,depth:8},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}}],surfaces:[{id:id(4),roomId:id(1),type:'wall',dimensions:{width:8,height:3},transform:pose}],openings:[{id:id(5),surfaceId:id(4),type:'door',dimensions:{width,height},offset:[1,height/2-1.5]}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:7,furnishings:[descriptor],placements:[],frameAttachments:[],openingAttachments:[attachment]},'org.exhibitos.studio/architectural-finishes':{version:1,walls:[{surfaceId:id(4),depth,preset:'plain',trimWidth:.04,baseboardHeight:.1,ceilingBand:false}]}}};
  const mounted=await mountOwnerWorkspacePlacement({...f.options,candidate,placementId:id(5),openingAttachment:attachment});
  expect(f.object.matrixAutoUpdate).toBe(false);
  expect(new three.Vector3().setFromMatrixPosition(f.object.matrix).toArray()).toEqual([3,0,-4]);
  mounted.dispose();
 }
});

it('mounts an in-envelope backed bench and rejects a taller back or raised seat',async()=>{
 for(const [seatY,backTop,valid] of [[.45,.82,true],[.45,.92,false],[.51,.82,false]] as const){
  const f=setup(),geometry=new three.BoxGeometry(1,1,1),material=new three.MeshBasicMaterial();
  const box=(dimensions:[number,number,number],position:[number,number,number])=>{
   const mesh=new three.Mesh(geometry,material);
   mesh.scale.set(...dimensions);mesh.position.set(...position);f.object.add(mesh);
  };
  box([1.5,.06,.56],[0,seatY-.03,0]);
  box([1.4,.15,.05],[0,backTop-.075,.28]);
  box([.06,.39,.06],[-.55,.195,-.20]);
  box([.06,.39,.06],[.55,.195,.20]);
  try{
   const mount=mountOwnerWorkspacePlacement({...f.options,seatDimensions:{kind:'backed',width:1.5,depth:.7,height:.45}});
   if(valid){
    const placement=await mount;
    expect(placement.seatFootprintMatches).toBe(true);
    expect(f.room.children).toEqual([f.object]);
    placement.dispose();
   }else{
    await expect(mount).rejects.toThrow('WORKSPACE_BACKED_BENCH_FIT');
    expect(f.room.children).toHaveLength(0);
   }
  }finally{geometry.dispose();material.dispose();}
 }
});

it('uses an explicitly positive-Z model basis for fit and display while preserving every original node and outer placement',async()=>{
 vi.useFakeTimers();const f=setup(),geometry=new three.BoxGeometry(1,1,1),material=new three.MeshBasicMaterial();
 const box=(dimensions:[number,number,number],position:[number,number,number])=>{const mesh=new three.Mesh(geometry,material);mesh.scale.set(...dimensions);mesh.position.set(...position);f.object.add(mesh);};
 box([1.5,.06,.56],[0,.42,0]);box([1.4,.15,.05],[0,.745,-.28]);box([.06,.39,.06],[-.55,.195,-.20]);box([.06,.39,.06],[.55,.195,.20]);
 const nodeTransforms=()=>{const values:unknown[]=[];f.object.traverse(node=>values.push([node.uuid,node.position.toArray(),node.quaternion.toArray(),node.scale.toArray()]));return values;},before=nodeTransforms(),candidate=structuredClone(f.options.candidate);
 try{
  const mounted=await mountOwnerWorkspacePlacement({...f.options,seatDimensions:{kind:'backed',width:1.5,depth:.7,height:.45,modelForward:'positive-z'}});
  expect(mounted.seatFootprintMatches).toBe(true);expect(mounted.object).not.toBe(f.object);expect(f.room.children).toEqual([mounted.object]);
  expect(mounted.object.position.toArray()).toEqual([1,0,2]);expect(mounted.object.rotation.y).toBe(.5);expect(mounted.object.scale.toArray()).toEqual([1.5,1.5,1.5]);
  expect(f.object.parent!.rotation.y).toBe(Math.PI);expect(nodeTransforms()).toEqual(before);expect(f.options.candidate).toEqual(candidate);
  // All consumers receive the same aligned root; revocation hides and detaches it.
  f.check.mockRejectedValueOnce(Error('OWNER_REVOKED'));await vi.advanceTimersByTimeAsync(5000);
  expect(mounted.object.visible).toBe(false);expect(f.room.children).toHaveLength(0);expect(mounted.object.children).toHaveLength(0);expect(f.dispose).toHaveBeenCalledOnce();expect(f.onRevoked).toHaveBeenCalledOnce();mounted.dispose();expect(f.dispose).toHaveBeenCalledOnce();
 }finally{geometry.dispose();material.dispose();}
});

it.each([undefined,'negative-z'] as const)('does not infer a reversed model basis when declaration is %s',async modelForward=>{
 const f=setup(),geometry=new three.BoxGeometry(1,1,1),material=new three.MeshBasicMaterial();
 for(const [size,point] of [[[1.5,.06,.56],[0,.42,0]],[[1.4,.15,.05],[0,.745,-.28]],[[.06,.39,.06],[-.55,.195,-.20]]] as const){const mesh=new three.Mesh(geometry,material);mesh.scale.fromArray(size);mesh.position.fromArray(point);f.object.add(mesh);}
 try{await expect(mountOwnerWorkspacePlacement({...f.options,seatDimensions:{kind:'backed',width:1.5,depth:.7,height:.45,...(modelForward?{modelForward}:{})}})).rejects.toThrow('WORKSPACE_BACKED_BENCH_FIT');expect(f.room.children).toHaveLength(0);expect(f.dispose).toHaveBeenCalledOnce();}finally{geometry.dispose();material.dispose();}
});

it.each([[.51,.82],[.45,.92]] as const)('keeps incompatible seat/back geometry rejected despite explicit facing (%s/%s)',async(seatY,backTop)=>{
 const f=setup(),geometry=new three.BoxGeometry(1,1,1),material=new three.MeshBasicMaterial();
 for(const [size,point] of [[[1.5,.06,.56],[0,seatY-.03,0]],[[1.4,.15,.05],[0,backTop-.075,-.28]],[[.06,.39,.06],[-.55,.195,-.20]]] as const){const mesh=new three.Mesh(geometry,material);mesh.scale.fromArray(size);mesh.position.fromArray(point);f.object.add(mesh);}
 try{await expect(mountOwnerWorkspacePlacement({...f.options,seatDimensions:{kind:'backed',width:1.5,depth:.7,height:.45,modelForward:'positive-z'}})).rejects.toThrow('WORKSPACE_BACKED_BENCH_FIT');expect(f.room.children).toHaveLength(0);expect(f.object.parent).toBeNull();expect(f.dispose).toHaveBeenCalledOnce();}finally{geometry.dispose();material.dispose();}
});

it('rejects an unsupported facing declaration and cleans the loaded model',async()=>{
 const f=setup();await expect(mountOwnerWorkspacePlacement({...f.options,seatDimensions:{kind:'backed',width:1.5,depth:.7,height:.45,modelForward:'sideways' as never}})).rejects.toThrow('WORKSPACE_BENCH_MODEL_FORWARD');expect(f.dispose).toHaveBeenCalledOnce();expect(f.room.children).toHaveLength(0);
});

it('detaches and hides the aligned wrapper without releasing its draw reservation after uncertain cleanup',async()=>{
 const f=setup(),geometry=new three.BoxGeometry(1,1,1),material=new three.MeshBasicMaterial();
 for(const [size,point] of [[[1.5,.06,.56],[0,.42,0]],[[1.4,.15,.05],[0,.745,-.28]],[[.06,.39,.06],[-.55,.195,-.20]]] as const){const mesh=new three.Mesh(geometry,material);mesh.scale.fromArray(size);mesh.position.fromArray(point);f.object.add(mesh);}
 const release=vi.fn();vi.spyOn(f.options.scope,'reserve').mockReturnValue(release);
 try{
  const mounted=await mountOwnerWorkspacePlacement({...f.options,seatDimensions:{kind:'backed',width:1.5,depth:.7,height:.45,modelForward:'positive-z'}});f.dispose.mockImplementation(()=>{throw Error('CLEANUP_UNCERTAIN');});
  expect(()=>mounted.dispose()).toThrow('CLEANUP_UNCERTAIN');expect(mounted.object.visible).toBe(false);expect(f.room.children).toHaveLength(0);expect(f.object.parent).toBeNull();expect(release).not.toHaveBeenCalled();mounted.dispose();expect(f.dispose).toHaveBeenCalledOnce();
 }finally{geometry.dispose();material.dispose();}
});
