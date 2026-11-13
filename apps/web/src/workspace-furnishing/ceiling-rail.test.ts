// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {WORKSPACE_FURNISHING_NAMESPACE,ceilingRailAttachmentMatrix,ceilingRailDerivedPose} from '@exhibitos/studio-contract';
import {AssetPeakBudget,DEVICE_BUDGETS} from '../viewer/loading';
import {OwnerPreviewBudget} from './owner-preview-budget';
import {mountOwnerWorkspacePlacement} from './owner-placement';
import {loadWorkspaceFurnishingModel} from './model-loader';
import {ownerWorkspaceModelSource} from './owner-source';
vi.mock('./model-loader',()=>({loadWorkspaceFurnishingModel:vi.fn()}));
vi.mock('./owner-source',()=>({ownerWorkspaceModelSource:vi.fn()}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const q=Math.SQRT1_2,sha='a'.repeat(64),controller=new AbortController(),room=new three.Group();room.position.set(8,0,-7);room.rotation.y=.3;
 const surface={id:id(4),roomId:id(1),type:'ceiling',dimensions:{width:8,height:10},transform:{position:[0,4,0],rotation:[q,0,0,q],scale:[1,1,1]}};
 const attachment={placementId:id(3),surfaceId:surface.id,anchor:[-1.402,2.5],yaw:-Math.PI/2,gap:0};
 const pose=ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix);
 const item={id:id(2),version:1,kind:'ceiling-rail',name:'Synthetic passive rail',rights:{permissions:{display:true,download:true,export:true}},provenance:'Synthetic geometry',model:{mime:'model/gltf-binary',bytes:100,sha256:sha},fit:{version:1,sourceSha256:sha,sourceBytes:100,geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}}};
 const candidate={rooms:[{id:id(1),dimensions:{width:8,height:4,depth:10},transform:{position:[8,0,-7],rotation:[0,Math.sin(.15),0,Math.cos(.15)],scale:[1,1,1]}}],surfaces:[surface],placements:[],artworks:[],openings:[],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:11,furnishings:[item],placements:[{id:id(3),roomId:id(1),furnishingId:item.id,furnishingVersion:1,...pose}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]}}};
 const object=new three.Group(),geometry=new three.BoxGeometry(1,.035,.035);geometry.translate(0,-.0175,0);const mesh=new three.Mesh(geometry,new three.MeshStandardMaterial());object.add(mesh);
 const dispose=vi.fn(()=>object.removeFromParent()),check=vi.fn(async()=>{}),source={check,open:vi.fn()},onRevoked=vi.fn();
 vi.mocked(loadWorkspaceFurnishingModel).mockResolvedValue({object,draws:1,triangles:12,dispose} as never);vi.mocked(ownerWorkspaceModelSource).mockReturnValue(source);
 const options={three,renderer:{} as three.WebGLRenderer,candidate,scope:new OwnerPreviewBudget(id(9),vi.fn(),32,10000),roomId:id(1),placementId:id(3),room,signal:controller.signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,ledger:new AssetPeakBudget(1e8,()=>0),onRevoked};
 return {options,candidate,room,object,mesh,pose,source,check,dispose,onRevoked,controller};
}
it.each(['owner','publication'] as const)('renders a ceiling-derived ordinary rail pose once through the existing %s loader and preserves source geometry and attachment',async mode=>{
 const f=fixture(),before=structuredClone(f.candidate),positions=f.mesh.geometry.getAttribute('position').array.slice(),local=f.mesh.matrix.clone();
 const mounted=await mountOwnerWorkspacePlacement({...f.options,...(mode==='publication'?{source:f.source,sceneManagedAuthority:true}:{})});
 f.room.updateMatrixWorld(true);
 const expected=new three.Matrix4().multiplyMatrices(f.room.matrixWorld,new three.Matrix4().compose(new three.Vector3(...f.pose.position),new three.Quaternion().setFromAxisAngle(new three.Vector3(0,1,0),f.pose.yaw),new three.Vector3(1,1,1)));
 expect(mounted.object.matrixWorld.elements).toEqual(expected.elements);expect(f.mesh.matrix.elements).toEqual(local.elements);expect(f.mesh.geometry.getAttribute('position').array).toEqual(positions);expect(f.candidate).toEqual(before);
 expect(f.object.position.y).toBe(4);expect(f.object.scale.toArray()).toEqual([1,1,1]);mounted.dispose();expect(f.room.children).toHaveLength(0);expect(f.dispose).toHaveBeenCalledOnce();
});
it('rejects a stale ceiling pose instead of displaying the rail at an unrelated floor placement',async()=>{
 const f=fixture();f.candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE].placements[0]!.position[1]=0;
 await expect(mountOwnerWorkspacePlacement(f.options)).rejects.toThrow('WORKSPACE_PLACEMENT_INVALID');expect(loadWorkspaceFurnishingModel).not.toHaveBeenCalled();expect(f.room.children).toHaveLength(0);
});
it('uses the ordinary owner authority revocation and cleanup for a placed rail',async()=>{
 vi.useFakeTimers();const f=fixture();await mountOwnerWorkspacePlacement(f.options);f.check.mockRejectedValueOnce(Error('REVOKED'));await vi.advanceTimersByTimeAsync(5000);
 expect(f.object.visible).toBe(false);expect(f.room.children).toHaveLength(0);expect(f.dispose).toHaveBeenCalledOnce();expect(f.onRevoked).toHaveBeenCalledOnce();
});
