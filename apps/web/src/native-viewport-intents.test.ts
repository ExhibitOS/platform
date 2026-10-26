// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import {newLight} from './placement/model';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {LightInspectorRequest} from './native-light-inspector';
import type {PlacementBegin} from './native-placement-protocol';
vi.mock('react-dom/client',()=>({createRoot:()=>({render:()=>{}})}));
vi.mock('./GeometryPreview',()=>({GeometryPreview:()=>null}));
vi.mock('./StudioFloorPlan',()=>({StudioFloorPlan:()=>null}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function sample(){
 vi.resetModules();const browser=new EventTarget() as unknown as Window;
 vi.stubGlobal('window',browser);vi.stubGlobal('document',{getElementById:()=>({})});
 const draft=newDraft(),light=newLight(draft.candidate.rooms[0]!.id);draft.candidate.lights=[light];
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
