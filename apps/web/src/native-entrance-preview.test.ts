// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {EntrancePreviewRequest} from './native-entrance-preview-protocol';
import {NativeEntrancePreview,type EntrancePreviewMeasurement} from './native-entrance-preview';
import {previewExhibition} from './NativeEntranceHost';
import {ENTRANCE_NAMESPACE} from '@exhibitos/studio-contract';
function fixture(){
 let frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:true};
 const request=(type:EntrancePreviewRequest['type']='show'):EntrancePreviewRequest=>({version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type,device:'desktop',scenario:'normal',reducedMotion:false,theme:null,locale:null});
 const scope={enter:vi.fn(async()=>{}),cancelEntry:vi.fn(),close:vi.fn()},scene={begin:vi.fn(()=>scope)},notify=vi.fn(),authenticate=vi.fn(async(_frame:NativeViewportFrame,signal:AbortSignal)=>signal.throwIfAborted());
 const editorReady=vi.fn(async()=>({mode:'editor' as const,imageStatus:'absent' as const,viewport:{width:1024,height:740},snapshotRect:{x:0,y:0,width:1024,height:740}}));
 const owner=new NativeEntrancePreview({frame:()=>frame,authenticate,scene:()=>scene,idle:()=>true,notify,editorReady});
 let measurement:EntrancePreviewMeasurement;
 const show=async()=>{const original=request(),pending=owner.request(original);await vi.waitFor(()=>expect(owner.view).toBeDefined());const intent=owner.view!;measurement={mode:'cover',renderGeneration:intent.generation,imageStatus:'ready',viewport:{width:1024,height:740},snapshotRect:{x:0,y:0,width:1024,height:740}};owner.ready(intent,()=>structuredClone(measurement));return {original,reply:await pending,intent};};
 return {owner,scene,scope,notify,authenticate,editorReady,request,show,frame:()=>frame,rebind:()=>{frame={...frame,sequence:frame.sequence+1};owner.invalidate();},changeSource:()=>{frame.draft.candidate.title='Changed';},changeGeometry:(delta:Partial<EntrancePreviewMeasurement>)=>{measurement={...measurement,...delta};}};
}
it('authenticates show and readonly state, echoes full draft and never renders or consumes a replay on repeated state checks',async()=>{
 const s=fixture(),{original,reply}=await s.show(),notifications=s.notify.mock.calls.length;
 expect(reply.baseDraft).toEqual(s.frame().draft);expect(reply.baseDraft).not.toBe(s.frame().draft);expect(reply.theme).toBeNull();expect(reply.locale).toBeNull();
 expect(await s.owner.state(original)).toEqual(reply);expect(await s.owner.state(original)).toEqual(reply);expect(s.scene.begin).toHaveBeenCalledOnce();expect(s.notify).toHaveBeenCalledTimes(notifications);
 await expect(s.owner.request(original)).rejects.toThrow('ENTRANCE_PREVIEW_REPLAY');expect(s.owner.view?.generation).toBe(reply.renderGeneration);s.owner.invalidate();
});
it('announces readonly ownership synchronously while session authentication is still pending',async()=>{
 const s=fixture();let complete!:()=>void;s.authenticate.mockImplementation(()=>new Promise<void>(resolve=>{complete=resolve;}));
 const pending=s.owner.request(s.request()).then(()=>Error('UNEXPECTED_READY'),error=>error as Error);
 expect(s.owner.active).toBe(true);expect(s.owner.view).toBeUndefined();expect(s.notify).toHaveBeenCalledOnce();
 s.owner.invalidate();complete();expect((await pending).message).toBe('ENTRANCE_PREVIEW_STALE');expect(s.owner.active).toBe(false);
});
it('close preempts an unready slow request, restores only its scope and rejects a late old ready callback',async()=>{
 const s=fixture(),first=s.owner.request({...s.request(),scenario:'slow'}).then(()=>Error('UNEXPECTED_READY'),error=>error as Error);await vi.waitFor(()=>expect(s.owner.view).toBeDefined());const old=s.owner.view!;
 const reply=await s.owner.request(s.request('close'));expect((await first).message).toBe('ENTRANCE_PREVIEW_STALE');expect(reply.mode).toBe('editor');expect(s.scope.close).toHaveBeenCalledOnce();expect(s.owner.active).toBe(false);
 s.owner.ready(old,()=>{throw Error('LATE_CALLBACK_MUST_NOT_RUN');});expect(s.owner.active).toBe(false);
});
it('state rejects source/options/image/rectangle drift without mutation, render or generation advance',async()=>{
 const s=fixture(),{original,reply}=await s.show(),generation=s.owner.view!.generation,notifications=s.notify.mock.calls.length;
 await expect(s.owner.state({...original,locale:'ko'})).rejects.toThrow('ENTRANCE_PREVIEW_STALE');
 s.changeGeometry({imageStatus:'failed'});await expect(s.owner.state(original)).rejects.toThrow('ENTRANCE_PREVIEW_STALE');
 s.changeGeometry({imageStatus:'ready',snapshotRect:{x:1,y:0,width:1023,height:740}});await expect(s.owner.state(original)).rejects.toThrow('ENTRANCE_PREVIEW_STALE');
 s.changeSource();await expect(s.owner.state(original)).rejects.toThrow('ENTRANCE_PREVIEW_STALE');expect(s.owner.view!.generation).toBe(generation);expect(reply.renderGeneration).toBe(generation);expect(s.notify).toHaveBeenCalledTimes(notifications);expect(s.scope.close).not.toHaveBeenCalled();s.owner.invalidate();
});
it('ordinary frame invalidation rejects pending snapshots and preserves the replacement frame',async()=>{
 const s=fixture(),{original,intent}=await s.show();s.rebind();expect(s.owner.active).toBe(false);expect(s.scope.close).toHaveBeenCalledOnce();await expect(s.owner.state(original)).rejects.toThrow('ENTRANCE_PREVIEW_STALE');
 s.owner.ready(intent,()=>{throw Error('STALE_FRAME_MUST_NOT_MEASURE');});expect(s.frame().sequence).toBe(2);
});
it('theme preview overrides reset only compatible layout/effects on a clone and preserve content, image settings and unrelated source',()=>{
 const s=fixture(),frame=s.frame();frame.draft.candidate.extensions={[ENTRANCE_NAMESPACE]:{version:1,artist:'Artist',introduction:'Copy',imageAlt:'',mobilePosition:'top',design:{version:1,theme:'poster',image:{fit:'contain',focus:[.2,.8]},palette:'dark',type:'serif',ticket:{showDate:false},layout:{copyRatio:.4},effects:{cover:'mask'},translations:[{locale:'ko',title:'제목'}]}},'example.org/preserved':{id:frame.tenantId}};
 const original=structuredClone(frame.draft),request={...s.request(),theme:'invitation' as const},next=previewExhibition({frame,request,generation:1,signal:new AbortController().signal,scope:s.scope}),settings=next.extensions![ENTRANCE_NAMESPACE] as {design:Record<string,unknown>};
 expect(settings.design).toEqual({version:1,theme:'invitation',image:{fit:'contain',focus:[.2,.8]},palette:'dark',type:'serif',ticket:{showDate:false},translations:[{locale:'ko',title:'제목'}]});expect(next.extensions!['example.org/preserved']).toEqual({id:frame.tenantId});expect(frame.draft).toEqual(original);
});
