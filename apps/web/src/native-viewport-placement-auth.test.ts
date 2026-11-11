// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';

const capture=vi.hoisted(()=>({hooks:undefined as undefined|{authenticate:(frame:NativeViewportFrame,signal:AbortSignal)=>Promise<void>;suspended:()=>boolean}}));
vi.mock('./native-placement',()=>({NativePlacement:class {active=false;constructor(hooks:typeof capture.hooks){capture.hooks=hooks;}rebind(){}cancel(){}request(){throw Error('unused');}}}));
vi.mock('react-dom/client',()=>({createRoot:()=>({render:()=>{}})}));
vi.mock('./GeometryPreview',()=>({GeometryPreview:()=>null}));vi.mock('./StudioFloorPlan',()=>({StudioFloorPlan:()=>null}));
afterEach(()=>{capture.hooks=undefined;vi.unstubAllGlobals();vi.resetModules();});
it('rejects an old placement session after auth changes even when the same user reopens',async()=>{
 const browser=new EventTarget() as unknown as Window;vi.stubGlobal('window',browser);vi.stubGlobal('document',{getElementById:()=>({})});
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false};
 const session=()=>Response.json({tenantId:frame.tenantId,userId:frame.principalId,role:'admin',csrfToken:'old',expiresAt:'2099-01-01T00:00:00Z'});let delayed=false,release!:(value:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>delayed?new Promise<Response>(resolve=>{release=resolve;}):Promise.resolve(session())));
 await import('./native-viewport');await browser.exhibitosViewport!.accept(frame);delayed=true;
 const pending=capture.hooks!.authenticate(frame,new AbortController().signal),rejected=expect(pending).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');
 browser.dispatchEvent(new Event('exhibitos-auth-changed'));expect(capture.hooks!.suspended()).toBe(true);delayed=false;await browser.exhibitosViewport!.accept({...frame,sequence:2});expect(capture.hooks!.suspended()).toBe(false);release(session());await rejected;
});

it('advertises rendered thumbnails only for a ready editable session and rejects lost readiness during work',async()=>{
 const browser=new EventTarget() as unknown as Window;vi.stubGlobal('window',browser);vi.stubGlobal('document',{getElementById:()=>({})});
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false};
 let profile:string|undefined;
 vi.stubGlobal('fetch',async()=>Response.json({tenantId:frame.tenantId,userId:frame.principalId,role:'admin',csrfToken:'csrf',expiresAt:'2099-01-01T00:00:00Z',nativeRenderedArtworkThumbnailProfile:profile}));
 await import('./native-viewport');
 expect((await browser.exhibitosViewport!.accept(frame)).capabilities).not.toContain('rendered-display-preview-v1');
 profile='rendered-display-preview-v1';const ready={...frame,sequence:2};
 expect((await browser.exhibitosViewport!.accept(ready)).capabilities).toContain('rendered-display-preview-v1');
 profile=undefined;await expect(capture.hooks!.authenticate(ready,new AbortController().signal)).rejects.toThrow('VIEWPORT_SCOPE_CHANGED');
 profile='rendered-display-preview-v1';expect((await browser.exhibitosViewport!.accept({...frame,sequence:3,disabled:true})).capabilities).not.toContain('rendered-display-preview-v1');
});
