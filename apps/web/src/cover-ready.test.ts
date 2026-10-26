// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {waitForCoverLayout} from './cover-ready';
afterEach(()=>vi.unstubAllGlobals());
function harness(){
 let next=0,fontReady!:()=>void;const frames=new Map<number,FrameRequestCallback>();
 vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{frames.set(++next,f);return next;});vi.stubGlobal('cancelAnimationFrame',(n:number)=>frames.delete(n));
 const element={ownerDocument:{fonts:{ready:new Promise<void>(resolve=>fontReady=resolve)}},isConnected:true,offsetWidth:800,offsetHeight:500,scrollWidth:800,scrollHeight:500,querySelectorAll:()=>[]};
 return {element,frames,fontReady:()=>fontReady(),tick:()=>{const pending=[...frames];frames.clear();for(const [,f] of pending)f(0);},ready:(signal:AbortSignal)=>waitForCoverLayout(element as unknown as HTMLElement,signal)};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
it('waits for real fonts then two equal display frames without a duration gate',async()=>{
 const h=harness(),abort=new AbortController();let ready=false;const work=h.ready(abort.signal).then(()=>ready=true);
 await flush();expect(h.frames.size).toBe(0);expect(ready).toBe(false);
 h.fontReady();await flush();h.tick();expect(ready).toBe(false);h.tick();await work;expect(ready).toBe(true);expect(h.frames.size).toBe(0);
});
it('requires fresh consecutive layout after a changed line wrap',async()=>{
 const h=harness(),work=h.ready(new AbortController().signal);h.fontReady();await flush();h.tick();h.element.offsetHeight=530;h.tick();expect(h.frames.size).toBe(1);h.tick();await work;
});
it('cancels a pending font or frame without stale completion or retained RAF',async()=>{
 const font=harness(),a=new AbortController(),first=font.ready(a.signal);a.abort(Error('left-cover'));await expect(first).rejects.toThrow('left-cover');font.fontReady();await flush();expect(font.frames.size).toBe(0);
 const frame=harness(),b=new AbortController(),second=frame.ready(b.signal);frame.fontReady();await flush();expect(frame.frames.size).toBe(1);b.abort(Error('new-generation'));await expect(second).rejects.toThrow('new-generation');expect(frame.frames.size).toBe(0);
});
it('rejects a detached face so the caller can retain the visible flat fallback',async()=>{
 const h=harness(),work=h.ready(new AbortController().signal);h.fontReady();await flush();h.element.isConnected=false;h.tick();await expect(work).rejects.toThrow('COVER_UNMOUNTED');expect(h.frames.size).toBe(0);
});
