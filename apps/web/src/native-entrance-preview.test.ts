// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {EntrancePreviewRequest} from './native-entrance-preview-protocol';
import {NativeEntrancePreview,type EntrancePreviewMeasurement} from './native-entrance-preview';
import {previewExhibition} from './NativeEntranceHost';
import {applyBenchCommand,ENTRANCE_NAMESPACE,PRESENTATION_NAMESPACE,presentationFor} from '@exhibitos/studio-contract';
function fixture(){
 let frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:true};
 const request=(type:Exclude<EntrancePreviewRequest['type'],'seat'>='show'):EntrancePreviewRequest=>({version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type,device:'desktop',scenario:'normal',reducedMotion:false,theme:null,locale:null});
 const scope={enter:vi.fn(async()=>{}),isSeated:vi.fn(()=>false),cancelEntry:vi.fn(),close:vi.fn()},scene={document:frame.draft.candidate,begin:vi.fn(()=>scope)},notify=vi.fn(),authenticate=vi.fn(async(_frame:NativeViewportFrame,signal:AbortSignal)=>signal.throwIfAborted());
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

function seatFixture(){
 const s=fixture(),frame=s.frame(),roomId=frame.draft.candidate.rooms[0]!.id;
 const benchId=crypto.randomUUID(),viewpointId=crypto.randomUUID();
 frame.draft.candidate=applyBenchCommand(frame.draft.candidate,{type:'add-bench',
  bench:{id:benchId,roomId,viewpointId,name:'Preview bench',position:[0,0,0],yaw:0,kind:'backed',dimensions:{width:1.5,depth:.7,height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0}},
  viewpoint:{id:viewpointId,roomId,name:'Preview viewpoint',position:[0,1.15,-.08],target:[0,1,-3],fov:50},
 });
 s.scene.document=frame.draft.candidate;
 const request={...s.request(),type:'seat' as const,benchId,viewpointId};
 const measured=():EntrancePreviewMeasurement=>({mode:'seated',renderGeneration:s.owner.view!.generation,imageStatus:'absent',viewport:{width:1024,height:740},snapshotRect:{x:0,y:0,width:1024,height:740}});
 return {...s,seatRequest:request,measured};
}

it('acknowledges a completed exact seat on the current draft and closes back to the editor',async()=>{
 const s=seatFixture(),draft=structuredClone(s.frame().draft),request=s.seatRequest,pending=s.owner.request(request);
 await vi.waitFor(()=>expect(s.owner.view).toBeDefined());
 s.scope.isSeated.mockReturnValue(true);
 s.owner.ready(s.owner.view!,s.measured);
 const reply=await pending;
 expect(reply).toMatchObject({mode:'seated',benchId:request.benchId,viewpointId:request.viewpointId,baseDraft:draft});
 expect(await s.owner.state(request)).toEqual(reply);
 s.scope.isSeated.mockReturnValue(false);
 await expect(s.owner.state(request)).rejects.toThrow('ENTRANCE_PREVIEW_STALE');
 const returned=await s.owner.request(s.request('close'));
 expect(returned.mode).toBe('editor');expect(returned).not.toHaveProperty('benchId');
 expect(s.scope.close).toHaveBeenCalledOnce();expect(s.frame().draft).toEqual(draft);
});

it('rejects a wrong frame, unrelated viewpoint and seat measurement without actual admission',async()=>{
 const s=seatFixture(),request=s.seatRequest;
 const {viewpointId,...missingViewpoint}=request;void viewpointId;
 await expect(s.owner.request(missingViewpoint)).rejects.toThrow('ENTRANCE_PREVIEW_INVALID');
 await expect(s.owner.request({...request,sequence:request.sequence+1})).rejects.toThrow('ENTRANCE_PREVIEW_STALE');
 const exhibition=s.frame().draft.candidate,presentation=presentationFor(exhibition),unrelatedViewpointId=crypto.randomUUID();
 presentation.viewpoints.push({...presentation.viewpoints[0]!,id:unrelatedViewpointId,name:'Unrelated authored viewpoint'});
 exhibition.extensions={...exhibition.extensions,[PRESENTATION_NAMESPACE]:presentation as unknown as NonNullable<typeof exhibition.extensions>[string]};
 await expect(s.owner.request({...request,requestId:crypto.randomUUID(),viewpointId:unrelatedViewpointId})).rejects.toThrow('ENTRANCE_PREVIEW_BENCH_MISMATCH');
 expect(s.scene.begin).not.toHaveBeenCalled();
 const pending=s.owner.request(request),refused=expect(pending).rejects.toThrow('ENTRANCE_PREVIEW_STALE');
 await vi.waitFor(()=>expect(s.owner.view).toBeDefined());
 s.owner.ready(s.owner.view!,s.measured);
 await refused;
 expect(s.scope.close).toHaveBeenCalledOnce();expect(s.owner.active).toBe(false);
});

it('returns the precise seat refusal and clears the borrowed scope',async()=>{
 const s=seatFixture(),pending=s.owner.request(s.seatRequest),refused=expect(pending).rejects.toThrow('BENCH_VIEW_PATH_UNSAFE');
 await vi.waitFor(()=>expect(s.owner.view).toBeDefined());
 s.owner.failed(s.owner.view!,Error('BENCH_VIEW_PATH_UNSAFE'));
 await refused;
 expect(s.scope.close).toHaveBeenCalledOnce();expect(s.owner.active).toBe(false);
});


it('ordinary Walk keeps its existing acknowledgment and can return to the editor',async()=>{
 const s=fixture(),request=s.request('walk'),pending=s.owner.request(request);
 await vi.waitFor(()=>expect(s.owner.view).toBeDefined());
 s.owner.ready(s.owner.view!,()=>({mode:'walk',renderGeneration:s.owner.view!.generation,imageStatus:'absent',viewport:{width:1024,height:740},snapshotRect:{x:0,y:0,width:1024,height:740}}));
 const reply=await pending;
 expect(reply.mode).toBe('walk');expect(reply).not.toHaveProperty('benchId');expect(reply).not.toHaveProperty('viewpointId');
 expect(s.scope.isSeated).not.toHaveBeenCalled();
 expect((await s.owner.request(s.request('close'))).mode).toBe('editor');
 expect(s.scope.close).toHaveBeenCalledOnce();
});


it('refuses to borrow a previous render of the same bench and viewpoint IDs',async()=>{
 const s=seatFixture(),previousScene=structuredClone(s.scene.document);
 const presentation=presentationFor(previousScene);
 presentation.viewpoints[0]!.target[1]-=.15;
 previousScene.extensions={...previousScene.extensions,[PRESENTATION_NAMESPACE]:presentation as unknown as NonNullable<typeof previousScene.extensions>[string]};
 s.scene.document=previousScene;
 await expect(s.owner.request(s.seatRequest)).rejects.toThrow('ENTRANCE_PREVIEW_NOT_READY');
 expect(s.scene.begin).not.toHaveBeenCalled();expect(s.owner.active).toBe(false);
});
