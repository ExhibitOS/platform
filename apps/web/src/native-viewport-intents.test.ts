import type {ArchitecturalFinishRequest} from './native-architectural-finishes';
import {whiteCubeSurfaces} from './geometry/model';
import type {PlaqueInspectorRequest} from './native-plaque-inspector';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import {newLight} from './placement/model';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {LightInspectorRequest} from './native-light-inspector';
import type {PlacementBegin} from './native-placement-protocol';
import type {BenchInspectorRequest} from './native-bench-inspector';
import type {LightDetailsRequest} from './native-light-details';
vi.mock('react-dom/client',()=>({createRoot:()=>({render:()=>{}})}));
vi.mock('./GeometryPreview',()=>({GeometryPreview:()=>null}));
vi.mock('./StudioFloorPlan',()=>({StudioFloorPlan:()=>null}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function sample(withWalls=false){
 vi.resetModules();const browser=new EventTarget() as unknown as Window;
 vi.stubGlobal('window',browser);vi.stubGlobal('document',{getElementById:()=>({})});
 const draft=newDraft(),light=newLight(draft.candidate.rooms[0]!.id);draft.candidate.lights=[light];if(withWalls)draft.candidate.surfaces=whiteCubeSurfaces(draft.candidate.rooms[0]!);
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false};
 const session=()=>Response.json({tenantId:frame.tenantId,userId:frame.principalId,role:'admin'}),fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>session());vi.stubGlobal('fetch',fetcher);
 await import('./native-viewport');const vm=browser.exhibitosViewport!;const accepted=await vm.accept(frame);fetcher.mockClear();
 const {id,...value}=light;
 const request:LightInspectorRequest={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type:'set-light',lightId:id,light:{...value,intensity:160}};
 const begin:PlacementBegin={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),phase:'begin',artworkId:crypto.randomUUID(),expectedRevision:1,placementId:crypto.randomUUID(),roomId:light.roomId,targetKind:'wall'};
 return {vm,frame,request,begin,session,fetcher,accepted};
}
it('the wired pending light request excludes placement begin, duplicate light and ordinary mutation, then releases after its checked reply',async()=>{
 const s=await sample();let resolve!:(response:Response)=>void;
 s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.lightInspector(s.request);
 expect(()=>s.vm.placement(s.begin)).toThrow('LIGHT_INSPECTOR_INTENT_ACTIVE');
 await expect(s.vm.lightInspector({...s.request,requestId:crypto.randomUUID()})).rejects.toThrow('LIGHT_INSPECTOR_INTENT_ACTIVE');
 expect(()=>s.vm.action({type:'add-light',roomId:s.begin.roomId})).toThrow('LIGHT_INSPECTOR_INTENT_ACTIVE');
 expect(s.fetcher).toHaveBeenCalledTimes(1);resolve(s.session());const reply=await pending;
 expect(reply).toMatchObject({requestId:s.request.requestId,lightId:s.request.lightId,candidate:{lights:[{id:s.request.lightId,intensity:160}]}});
 expect(s.frame.draft.candidate.lights[0]!.intensity).toBe(100);
 expect(()=>s.vm.placement(s.begin)).toThrow('PLACEMENT_RENDERER_NOT_READY');
 expect(s.accepted.capabilities).toContain('place-artwork-v1');expect(s.accepted.capabilities).toContain('light-inspector-v1');
});
it('an existing temporary placement excludes the wired light request before any authenticated work or source mutation',async()=>{
 const s=await sample(),{NativePlacement}=await import('./native-placement');vi.spyOn(NativePlacement.prototype,'active','get').mockReturnValue(true);
 await expect(s.vm.lightInspector(s.request)).rejects.toThrow('PLACEMENT_INTENT_ACTIVE');expect(s.fetcher).not.toHaveBeenCalled();expect(s.frame.draft.candidate.lights[0]!.intensity).toBe(100);
});
it('a frame change fences a late light result and its finally releases the pending intent without returning a candidate',async()=>{
 const s=await sample();let resolve!:(response:Response)=>void;
 s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.lightInspector(s.request),rejection=expect(pending).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');
 await s.vm.accept({...s.frame,sequence:2});resolve(s.session());await rejection;
 expect(()=>s.vm.placement({...s.begin,sequence:2})).toThrow('PLACEMENT_RENDERER_NOT_READY');expect(s.frame.draft.candidate.lights[0]!.intensity).toBe(100);
});
function benchRequest(s:Awaited<ReturnType<typeof sample>>):BenchInspectorRequest{
 const roomId=s.frame.draft.candidate.rooms[0]!.id,viewpointId=crypto.randomUUID();
 return {version:1,epoch:s.frame.epoch,sequence:s.frame.sequence,tenantId:s.frame.tenantId,principalId:s.frame.principalId,requestId:crypto.randomUUID(),type:'add-bench',bench:{id:crypto.randomUUID(),name:'Bench',roomId,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:1.5,depth:.6,height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat',roomId,position:[0,1.15,0],target:[0,1,-2],fov:50}};
}
it('wired bench intent excludes placement/light/ordinary changes, authenticates twice, and releases after reply',async()=>{
 const s=await sample(),request=benchRequest(s);let resolve!:(response:Response)=>void;
 s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.benchInspector(request);
 expect(()=>s.vm.placement(s.begin)).toThrow('BENCH_INSPECTOR_INTENT_ACTIVE');await expect(s.vm.lightInspector(s.request)).rejects.toThrow('BENCH_INSPECTOR_INTENT_ACTIVE');
 await expect(s.vm.benchInspector({...request,requestId:crypto.randomUUID()})).rejects.toThrow('BENCH_INSPECTOR_INTENT_ACTIVE');expect(()=>s.vm.action({type:'add-light',roomId:s.begin.roomId})).toThrow('BENCH_INSPECTOR_INTENT_ACTIVE');
 resolve(s.session());const reply=await pending;expect(reply).toMatchObject({requestId:request.requestId,benchId:request.type==='remove-bench'?request.benchId:request.bench.id});expect(s.fetcher).toHaveBeenCalledTimes(2);expect(s.frame.draft.candidate.extensions?.['org.exhibitos.studio/benches']).toBeUndefined();expect(s.accepted.capabilities).toContain('bench-inspector-v1');
 expect(()=>s.vm.placement(s.begin)).toThrow('PLACEMENT_RENDERER_NOT_READY');await expect(s.vm.benchInspector(request)).rejects.toThrow('CATALOG_REQUEST_REPLAY');
});
it('late bench results are rejected after a new frame and release the optional intent',async()=>{
 const s=await sample(),request=benchRequest(s);let resolve!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.benchInspector(request),rejected=expect(pending).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');
 await s.vm.accept({...s.frame,sequence:2});resolve(s.session());await rejected;expect(()=>s.vm.placement(s.begin)).toThrow('PLACEMENT_RENDERER_NOT_READY');
});
function detailsRequest(s:Awaited<ReturnType<typeof sample>>):LightDetailsRequest{return {...s.request,type:'set-light-details',settings:{fixture:'none'}};}
it('light details wired pending intent excludes legacy light, bench, placement and ordinary edits, with authenticated exact reply',async()=>{
 const s=await sample(),request=detailsRequest(s);let resolve!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.lightDetails(request);
 await expect(s.vm.lightInspector(s.request)).rejects.toThrow('LIGHT_DETAILS_INTENT_ACTIVE');await expect(s.vm.benchInspector(benchRequest(s))).rejects.toThrow('LIGHT_DETAILS_INTENT_ACTIVE');expect(()=>s.vm.placement(s.begin)).toThrow('LIGHT_DETAILS_INTENT_ACTIVE');expect(()=>s.vm.action({type:'add-light',roomId:s.begin.roomId})).toThrow('LIGHT_DETAILS_INTENT_ACTIVE');
 resolve(s.session());const reply=await pending;expect(reply).toMatchObject({requestId:request.requestId,lightId:request.lightId});expect(s.fetcher).toHaveBeenCalledTimes(2);expect(s.accepted.capabilities).toContain('light-fixture-aim-v1');expect(()=>s.vm.placement(s.begin)).toThrow('PLACEMENT_RENDERER_NOT_READY');
});
it('light details late frame results are fenced and release the new optional intent',async()=>{
 const s=await sample();let resolve!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.lightDetails(detailsRequest(s)),rejected=expect(pending).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');await s.vm.accept({...s.frame,sequence:2});resolve(s.session());await rejected;expect(()=>s.vm.placement(s.begin)).toThrow('PLACEMENT_RENDERER_NOT_READY');
});

function plaqueRequest(s:Awaited<ReturnType<typeof sample>>):PlaqueInspectorRequest{
 const roomId=s.frame.draft.candidate.rooms[0]!.id;
 return {version:1,epoch:s.frame.epoch,sequence:s.frame.sequence,tenantId:s.frame.tenantId,principalId:s.frame.principalId,requestId:crypto.randomUUID(),type:'add-plaque',plaque:{id:crypto.randomUUID(),roomId,source:{kind:'exhibition'},position:[0,1.5,0],rotation:[0,0,0,1],dimensions:{width:1,height:.6},visible:true}};
}
it('wired plaque intent excludes placement/light/ordinary changes, authenticates twice, and releases after reply',async()=>{
 const s=await sample(),request=plaqueRequest(s);let resolve!:(response:Response)=>void;
 s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.plaqueInspector(request);
 expect(()=>s.vm.placement(s.begin)).toThrow('PLAQUE_INSPECTOR_INTENT_ACTIVE');await expect(s.vm.lightInspector(s.request)).rejects.toThrow('PLAQUE_INSPECTOR_INTENT_ACTIVE');
 await expect(s.vm.benchInspector(benchRequest(s))).rejects.toThrow('PLAQUE_INSPECTOR_INTENT_ACTIVE');await expect(s.vm.lightDetails(detailsRequest(s))).rejects.toThrow('PLAQUE_INSPECTOR_INTENT_ACTIVE');await expect(s.vm.plaqueInspector({...request,requestId:crypto.randomUUID()})).rejects.toThrow('PLAQUE_INSPECTOR_INTENT_ACTIVE');expect(()=>s.vm.action({type:'add-light',roomId:s.begin.roomId})).toThrow('PLAQUE_INSPECTOR_INTENT_ACTIVE');
 resolve(s.session());const reply=await pending;expect(reply).toMatchObject({requestId:request.requestId,plaqueId:request.type==='remove-plaque'?request.plaqueId:request.plaque.id});expect(s.fetcher).toHaveBeenCalledTimes(2);expect(s.frame.draft.candidate.extensions?.['org.exhibitos.studio/plaques']).toBeUndefined();expect(s.accepted.capabilities).toContain('plaque-inspector-v1');
 expect(()=>s.vm.placement(s.begin)).toThrow('PLACEMENT_RENDERER_NOT_READY');await expect(s.vm.plaqueInspector(request)).rejects.toThrow('CATALOG_REQUEST_REPLAY');
});
it('late plaque results are rejected after a new frame and release the optional intent',async()=>{
 const s=await sample(),request=plaqueRequest(s);let resolve!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.plaqueInspector(request),rejected=expect(pending).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');
 await s.vm.accept({...s.frame,sequence:2});resolve(s.session());await rejected;expect(()=>s.vm.placement(s.begin)).toThrow('PLACEMENT_RENDERER_NOT_READY');
});

function architecturalRequest(s:Awaited<ReturnType<typeof sample>>):ArchitecturalFinishRequest{return {version:1,epoch:s.frame.epoch,sequence:s.frame.sequence,tenantId:s.frame.tenantId,principalId:s.frame.principalId,requestId:crypto.randomUUID(),type:'set-wall-finish',wall:{surfaceId:s.frame.draft.candidate.surfaces[0]!.id,depth:.12,preset:'painted-edge',trimWidth:.04,baseboardHeight:.1,ceilingBand:true}};}
it('architectural finish wired intent excludes all editing intents, rechecks auth and keeps source unchanged',async()=>{
 const s=await sample(true),request=architecturalRequest(s),before=structuredClone(s.frame);let resolve!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.architecturalFinishes(request);
 expect(()=>s.vm.placement(s.begin)).toThrow('ARCHITECTURAL_FINISH_INTENT_ACTIVE');expect(()=>s.vm.action({type:'add-light',roomId:s.begin.roomId})).toThrow('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
 for(const call of [()=>s.vm.lightInspector(s.request),()=>s.vm.lightDetails(detailsRequest(s)),()=>s.vm.benchInspector(benchRequest(s)),()=>s.vm.plaqueInspector(plaqueRequest(s)),()=>s.vm.architecturalFinishes({...request,requestId:crypto.randomUUID()})])await expect(call()).rejects.toThrow('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
 resolve(s.session());expect(await pending).toMatchObject({requestId:request.requestId,surfaceId:request.type==='set-wall-finish'?request.wall.surfaceId:request.surfaceId});expect(s.fetcher).toHaveBeenCalledTimes(2);expect(s.frame).toEqual(before);expect(s.accepted.capabilities).toContain('architectural-finishes-v1');await expect(s.vm.architecturalFinishes(request)).rejects.toThrow('CATALOG_REQUEST_REPLAY');
});
it('architectural finish late frame result is rejected and releases its intent',async()=>{const s=await sample(true);let resolve!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.architecturalFinishes(architecturalRequest(s)),rejected=expect(pending).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');await s.vm.accept({...s.frame,sequence:2});resolve(s.session());await rejected;expect(()=>s.vm.placement(s.begin)).toThrow('PLACEMENT_RENDERER_NOT_READY');});
