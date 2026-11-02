// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';

const hooks=vi.hoisted(()=>({cleanups:[] as Array<()=>void>,setCalls:0,render:undefined as undefined|(()=>unknown)}));
vi.mock('react',async(importOriginal)=>({...(await importOriginal<typeof import('react')>()),
 useState:(initial:unknown)=>[initial,()=>{hooks.setCalls++;}],
 useMemo:(fn:()=>unknown)=>fn(),useCallback:(fn:unknown)=>fn,
 useEffect:(fn:()=>void|(()=>void))=>{const cleanup=fn();if(cleanup)hooks.cleanups.push(cleanup);},
}));
vi.mock('react-dom/client',()=>({createRoot:()=>({render:(element:{type:()=>unknown})=>{hooks.render=element.type;hooks.render();}})}));
vi.mock('./GeometryPreview',()=>({GeometryPreview:()=>null}));
vi.mock('./StudioFloorPlan',()=>({StudioFloorPlan:()=>null}));
afterEach(()=>{hooks.cleanups=[];hooks.setCalls=0;hooks.render=undefined;vi.unstubAllGlobals();vi.resetModules();});
it('does not apply a delayed frame after viewport unmount and remount',async()=>{
 const browser=new EventTarget() as unknown as Window;vi.stubGlobal('window',browser);vi.stubGlobal('document',{getElementById:()=>({})});
 let release!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{release=r;})));
 await import('./native-viewport');const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false};
 const pending=browser.exhibitosViewport!.accept(frame),rejected=expect(pending).rejects.toThrow('VIEWPORT_FRAME_STALE');
 for(const cleanup of hooks.cleanups.splice(0))cleanup();hooks.setCalls=0;hooks.render!();
 release(Response.json({tenantId:frame.tenantId,userId:frame.principalId,role:'admin'}));await rejected;expect(hooks.setCalls).toBe(0);
});
