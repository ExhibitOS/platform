// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
const preview=vi.hoisted(()=>({invalidate:vi.fn(async(_reason:string)=>{void _reason;}),request:vi.fn(async(_value:unknown)=>{void _value;return {capability:'gpu-candidate-preview-v1'};})}));
vi.mock('./viewer/gpu-candidate-preview',()=>({NativeGpuCandidatePreview:class {invalidate=preview.invalidate;request=preview.request;}}));
vi.mock('react-dom/client',()=>({createRoot:()=>({render(){}})}));
vi.mock('./GeometryPreview',()=>({GeometryPreview:()=>null}));
vi.mock('./StudioFloorPlan',()=>({StudioFloorPlan:()=>null}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();vi.resetModules();});
async function environment(){
 vi.resetModules();preview.invalidate.mockResolvedValue(undefined);
 const browser=new EventTarget() as unknown as Window,doc=Object.assign(new EventTarget(),{hidden:false,getElementById:()=>({})});
 vi.stubGlobal('window',browser);vi.stubGlobal('document',doc);
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false};
 const fetcher=vi.fn(async()=>Response.json({tenantId:frame.tenantId,userId:frame.principalId,role:'admin'}));vi.stubGlobal('fetch',fetcher);
 await import('./native-viewport');return {vm:browser.exhibitosViewport!,browser,doc,frame,fetcher};
}
test('standalone method is available before any editor frame; pending retirement blocks editing before its first await',async()=>{
 const {vm,frame,fetcher}=await environment();await vm.gpuCandidatePreview({version:1,phase:'capability'});expect(preview.request).toHaveBeenCalledWith({version:1,phase:'capability'});
 let finish!:()=>void;preview.invalidate.mockReturnValueOnce(new Promise<void>(resolve=>{finish=resolve;}));
 const accepting=vm.accept(frame);expect(preview.invalidate).toHaveBeenCalledWith('editor-frame');expect(fetcher).not.toHaveBeenCalled();
 expect(()=>vm.action({type:'add-light',roomId:frame.draft.candidate.rooms[0]!.id})).toThrow('VIEWPORT_BOUNDED_READ_ONLY');
 finish();expect(await accepting).toMatchObject({accepted:true});expect(fetcher).toHaveBeenCalledOnce();
});
test('unknown preview retirement refuses editor admission before authentication or rendering',async()=>{
 const {vm,frame,fetcher}=await environment();preview.invalidate.mockRejectedValueOnce(Error('RELEASE_UNCONFIRMED'));
 await expect(vm.accept(frame)).rejects.toThrow('RELEASE_UNCONFIRMED');expect(fetcher).not.toHaveBeenCalled();
});
test('visibility, authority and teardown events invalidate the operation-owned preview',async()=>{
 const {browser,doc}=await environment();doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));browser.dispatchEvent(new Event('exhibitos-auth-changed'));browser.dispatchEvent(new Event('pagehide'));
 expect(preview.invalidate.mock.calls.map(([reason])=>reason)).toEqual(['hidden','authority-changed','disposed']);
});
