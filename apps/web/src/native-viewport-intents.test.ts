import type {ArchitecturalFinishRequest} from './native-architectural-finishes';
import {whiteCubeSurfaces} from './geometry/model';
import type {PlaqueInspectorRequest} from './native-plaque-inspector';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {newLight} from './placement/model';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {LightInspectorRequest} from './native-light-inspector';
import type {PlacementBegin} from './native-placement-protocol';
import type {BenchInspectorRequest} from './native-bench-inspector';
import type {LightDetailsRequest} from './native-light-details';
import type {SpaceSettingsRequest} from './native-space-settings';
vi.mock('react-dom/client',()=>({createRoot:()=>({render:()=>{}})}));
vi.mock('./GeometryPreview',()=>({GeometryPreview:()=>null}));
vi.mock('./StudioFloorPlan',()=>({StudioFloorPlan:()=>null}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function sample(withWalls=false){
 vi.resetModules();const browser=new EventTarget() as unknown as Window;
 vi.stubGlobal('window',browser);vi.stubGlobal('document',{getElementById:()=>({})});
 const draft=newDraft(),light=newLight(draft.candidate.rooms[0]!.id);draft.candidate.lights=[light];if(withWalls)draft.candidate.surfaces=whiteCubeSurfaces(draft.candidate.rooms[0]!);
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false};
 const session=()=>Response.json({tenantId:frame.tenantId,userId:frame.principalId,role:'admin'}),fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{void _input;void _init;return session();});vi.stubGlobal('fetch',fetcher);
 await import('./native-viewport');const vm=browser.exhibitosViewport!;const accepted=await vm.accept(frame);fetcher.mockClear();
 const {id,...value}=light;
 const request:LightInspectorRequest={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type:'set-light',lightId:id,light:{...value,intensity:160}};
 const begin:PlacementBegin={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),phase:'begin',artworkId:crypto.randomUUID(),expectedRevision:1,placementId:crypto.randomUUID(),roomId:light.roomId,targetKind:'wall'};
 return {vm,frame,request,begin,session,fetcher,accepted};
}
async function oversizedFrame(base:NativeViewportFrame):Promise<NativeViewportFrame>{
 const f=structuredClone(base),sample=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),image=sample.exhibition.artworks.find(a=>a.artworkType==='image')!;
 f.sequence++;f.draft.candidate.artworks=Array.from({length:10},(_,i)=>{const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`synthetic-${i}.png`;a.assets[0]!.bytes=32*1024*1024;return a;});return f;
}
it('requires server authority for a bounded viewport and rejects stale or denied results',async()=>{
 const s=await sample(),large=await oversizedFrame(s.frame),session=()=>Response.json({tenantId:large.tenantId,userId:large.principalId,role:'admin',csrfToken:'csrf',expiresAt:'2099-01-01T00:00:00Z'});
 s.fetcher.mockImplementation(async(input)=>String(input).includes('native-viewport-check')?new Response('',{status:403}):session());
 await expect(s.vm.accept(large)).rejects.toThrow('VIEWPORT_FRAME_INVALID');
 s.fetcher.mockImplementation(async(input)=>String(input).includes('native-viewport-check')?Response.json({valid:true}):session());
 const accepted=await s.vm.accept(large);expect(accepted).toMatchObject({accepted:true,boundedReadOnly:true});
 expect(accepted.capabilities).not.toContain('place-artwork-v1');expect(accepted.capabilities).toContain('find-selection-v1');
 expect(()=>s.vm.action({type:'add-light',roomId:large.draft.candidate.rooms[0]!.id})).toThrow('VIEWPORT_BOUNDED_READ_ONLY');
 let release!:(response:Response)=>void;
 s.fetcher.mockImplementation(async(input)=>String(input).includes('native-viewport-check')?new Promise(r=>{release=r;}):session());
 const pending=s.vm.accept({...large,sequence:3});await vi.waitFor(()=>expect(release).toBeDefined());
 expect(()=>s.vm.action({type:'add-light',roomId:large.draft.candidate.rooms[0]!.id})).toThrow('VIEWPORT_BOUNDED_READ_ONLY');
 s.fetcher.mockImplementation(async()=>session());await s.vm.accept({...s.frame,sequence:4});release(Response.json({valid:true}));
 await expect(pending).rejects.toThrow('VIEWPORT_FRAME_STALE');
});
it('enables only scoped bounded placement editing after the exact saved ETag is validated',async()=>{
 const s=await sample(),large=await oversizedFrame(s.frame),workspaceId=crypto.randomUUID(),baseETag='"studio-r2-'+ 'a'.repeat(64)+'"';
 Object.assign(large,{workspaceId,baseETag});
 const capability={version:1,kind:'native-bounded-edit-v1',tenantId:large.tenantId,principalId:large.principalId,workspaceId,exhibitionId:large.draft.exhibitionId,revision:2,etag:baseETag};
 const session=()=>Response.json({tenantId:large.tenantId,userId:large.principalId,role:'admin',csrfToken:'csrf',expiresAt:'2099-01-01T00:00:00Z'});
 s.fetcher.mockImplementation(async(input,init)=>{if(String(input).includes('native-viewport-check')){expect((init?.headers as Record<string,string>)['if-match']).toBe(baseETag);return Response.json({valid:true,editingCapability:capability});}return session();});
 const ack=await s.vm.accept(large);expect(ack).toMatchObject({boundedReadOnly:false,editingCapability:capability});expect(ack.capabilities).not.toContain('place-artwork-v1');
 expect(()=>s.vm.action({type:'add-light',roomId:large.draft.candidate.rooms[0]!.id})).toThrow('VIEWPORT_BOUNDED_READ_ONLY');
 s.fetcher.mockImplementation(async(input)=>String(input).includes('native-viewport-check')?Response.json({valid:true,editingCapability:{...capability,workspaceId:crypto.randomUUID()}}):session());
 await expect(s.vm.accept({...large,sequence:3})).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');
 s.fetcher.mockImplementation(async(input)=>String(input).includes('native-viewport-check')?Response.json({valid:true}):session());
 expect(await s.vm.accept({...large,sequence:4})).toMatchObject({boundedReadOnly:true});
});
it('retains the ordinary path for a valid single asset larger than 32 MiB',async()=>{
 const s=await sample(),frame=await oversizedFrame(s.frame);frame.draft.candidate.artworks=frame.draft.candidate.artworks.slice(0,1);frame.draft.candidate.artworks[0]!.assets[0]!.bytes=33*1024*1024;
 expect(await s.vm.accept(frame)).toMatchObject({accepted:true,boundedReadOnly:false});expect(s.fetcher).toHaveBeenCalledTimes(1);expect(String(s.fetcher.mock.calls[0]![0])).toBe('/api/v1/auth/session');
});
it('invalidates a pending accept on auth change and allows a newly authenticated ordinary frame',async()=>{
 const s=await sample();let release!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 const pending=s.vm.accept({...s.frame,sequence:2}),rejected=expect(pending).rejects.toThrow('VIEWPORT_FRAME_STALE');
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 window.dispatchEvent(new Event('exhibitos-auth-changed'));release(s.session());await rejected;
 s.fetcher.mockImplementation(async()=>s.session());expect((await s.vm.accept({...s.frame,sequence:3})).boundedReadOnly).toBe(false);
 expect(()=>s.vm.action({type:'add-light',roomId:s.frame.draft.candidate.rooms[0]!.id})).not.toThrow();
});
it('does not complete an older editing intent while a later frame awaits approval',async()=>{
 const s=await sample(),large=await oversizedFrame(s.frame);let releaseIntent!:(response:Response)=>void,releaseCheck!:(response:Response)=>void;
 const session=()=>Response.json({tenantId:large.tenantId,userId:large.principalId,role:'admin',csrfToken:'csrf',expiresAt:'2099-01-01T00:00:00Z'});let first=true;
 s.fetcher.mockImplementation(async(input)=>{if(first){first=false;return new Promise(r=>{releaseIntent=r;});}return String(input).includes('native-viewport-check')?new Promise(r=>{releaseCheck=r;}):session();});
 const old=s.vm.lightInspector(s.request),rejected=expect(old).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');const next=s.vm.accept(large);
 await vi.waitFor(()=>expect(releaseCheck).toBeDefined());releaseIntent(session());await rejected;releaseCheck(Response.json({valid:true}));expect((await next).boundedReadOnly).toBe(true);
});
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

function spaceRequest(s:Awaited<ReturnType<typeof sample>>):SpaceSettingsRequest{return {version:1,epoch:s.frame.epoch,sequence:s.frame.sequence,tenantId:s.frame.tenantId,principalId:s.frame.principalId,requestId:crypto.randomUUID(),type:'set-space-lighting',settings:{version:1,baselineIntensity:0,reflectionIntensity:0}};}
it('space settings excludes conflicting edits, checks its reply and releases on stale frame',async()=>{
 const s=await sample(),request=spaceRequest(s),before=structuredClone(s.frame);let resolve!:(response:Response)=>void;
 s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.spaceSettings(request);
 expect(()=>s.vm.placement(s.begin)).toThrow('SPACE_SETTINGS_INTENT_ACTIVE');
 await expect(s.vm.lightInspector(s.request)).rejects.toThrow('SPACE_SETTINGS_INTENT_ACTIVE');
 await expect(s.vm.spaceSettings({...request,requestId:crypto.randomUUID()})).rejects.toThrow('SPACE_SETTINGS_INTENT_ACTIVE');
 expect(()=>s.vm.action({type:'add-light',roomId:s.begin.roomId})).toThrow('SPACE_SETTINGS_INTENT_ACTIVE');
 resolve(s.session());expect(await pending).toMatchObject({requestId:request.requestId,candidate:{extensions:{'org.exhibitos.studio/space-lighting':request.settings}}});expect(s.frame).toEqual(before);expect(s.accepted.capabilities).toContain('space-settings-v1');
 await expect(s.vm.spaceSettings(request)).rejects.toThrow('CATALOG_REQUEST_REPLAY');
 s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const late=s.vm.spaceSettings({...request,requestId:crypto.randomUUID()}),rejected=expect(late).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');
 await s.vm.accept({...s.frame,sequence:2});resolve(s.session());await rejected;expect(()=>s.vm.placement({...s.begin,sequence:2})).toThrow('PLACEMENT_RENDERER_NOT_READY');
});

it('viewing plan is an authenticated profile-only proposal with replay/exclusion and stale-result fences',async()=>{
 const s=await sample(),before=structuredClone(s.frame),request={version:1 as const,epoch:s.frame.epoch,sequence:s.frame.sequence,tenantId:s.frame.tenantId,principalId:s.frame.principalId,requestId:crypto.randomUUID(),type:'set-viewing-plan' as const,plan:{version:1 as const,stops:[]}};
 let resolve!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.viewingPlan(request);
 await expect(s.vm.viewingPlan({...request,requestId:crypto.randomUUID()})).rejects.toThrow('VIEWING_PLAN_INTENT_ACTIVE');
 resolve(s.session());const reply=await pending;expect(Object.keys(reply).sort()).toEqual(['candidate','epoch','principalId','requestId','sequence','tenantId','version']);
 expect(reply.candidate).toEqual({...s.frame.draft.candidate,extensions:{...s.frame.draft.candidate.extensions,'org.exhibitos.viewer/viewing-plan':request.plan}});expect(s.frame).toEqual(before);expect(s.accepted.capabilities).toContain('viewing-plan-v1');
 await expect(s.vm.viewingPlan(request)).rejects.toThrow('CATALOG_REQUEST_REPLAY');
 s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const late=s.vm.viewingPlan({...request,requestId:crypto.randomUUID()}),rejected=expect(late).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');await s.vm.accept({...s.frame,sequence:2});resolve(s.session());await rejected;
});

it('v2 furnishing intent fences other mutations, authenticates twice and rejects replay and stale frames',async()=>{
 const s=await sample(),bench=benchRequest(s);if(bench.type!=='add-bench')throw Error('fixture');const {applyBenchCommand}=await import('@exhibitos/studio-contract');
 const next=structuredClone(s.frame);next.sequence=2;next.draft.candidate=applyBenchCommand(next.draft.candidate,{type:'add-bench',bench:bench.bench,viewpoint:bench.viewpoint});const accepted=await s.vm.accept(next);expect(accepted.capabilities).toContain('furnishing-visuals-v2');s.fetcher.mockClear();
 const request={version:1 as const,epoch:next.epoch,sequence:next.sequence,tenantId:next.tenantId,principalId:next.principalId,requestId:crypto.randomUUID(),type:'set-furnishing-visual' as const,hostKind:'bench' as const,hostId:bench.bench.id,catalogId:'backless-oak-bench' as const,catalogVersion:1 as const,pose:{position:[0,0,0] as [number,number,number],yaw:0,scale:1}};
 let resolveLight!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolveLight=r;}));const light=s.vm.lightInspector({...s.request,sequence:2,requestId:crypto.randomUUID()});await expect(s.vm.furnishingVisualsV2(request)).rejects.toThrow('VIEWPORT_INTENT_ACTIVE');resolveLight(s.session());await light;s.fetcher.mockClear();
 let resolve!:(response:Response)=>void;s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=s.vm.furnishingVisualsV2(request);
 expect(()=>s.vm.action({type:'add-light',roomId:bench.bench.roomId})).toThrow('FURNISHING_INTENT_ACTIVE');expect(()=>s.vm.placement({...s.begin,sequence:2})).toThrow('FURNISHING_INTENT_ACTIVE');await expect(s.vm.lightInspector({...s.request,sequence:2,requestId:crypto.randomUUID()})).rejects.toThrow('FURNISHING_INTENT_ACTIVE');await expect(s.vm.furnishingVisualsV2({...request,requestId:crypto.randomUUID()})).rejects.toThrow('FURNISHING_INTENT_ACTIVE');
 resolve(s.session());const reply=await pending;expect(Object.keys(reply).sort()).toEqual(['candidate','epoch','principalId','requestId','sequence','tenantId','version']);expect(reply.requestId).toBe(request.requestId);expect(s.fetcher).toHaveBeenCalledTimes(2);expect(next.draft.candidate.extensions?.['org.exhibitos.studio/furnishing-visuals']).toBeUndefined();await expect(s.vm.furnishingVisualsV2(request)).rejects.toThrow('CATALOG_REQUEST_REPLAY');
 const delayed={...request,requestId:crypto.randomUUID()};s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const late=s.vm.furnishingVisualsV2(delayed),rejected=expect(late).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');await s.vm.accept({...next,sequence:3});resolve(s.session());await rejected;expect(()=>s.vm.placement({...s.begin,sequence:3})).toThrow('PLACEMENT_RENDERER_NOT_READY');
});
