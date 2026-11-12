// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {completeDetailCommands} from './detail-command-completion';
it('waits for command completion and deletes its own fence',async()=>{
 const sync={} as WebGLSync;let calls=0;const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,isContextLost:()=>false,fenceSync:()=>sync,flush:vi.fn(),clientWaitSync:()=>++calls===1?0:3,deleteSync:vi.fn()} as unknown as WebGL2RenderingContext;
 await completeDetailCommands(gl);expect(calls).toBe(2);expect(gl.flush).toHaveBeenCalledOnce();expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
});
it('fails closed on lost context or failed command wait',async()=>{
 const lost={isContextLost:()=>true} as WebGL2RenderingContext;await expect(completeDetailCommands(lost)).rejects.toThrow('DETAIL_CONTEXT_LOST');
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,isContextLost:()=>false,fenceSync:()=>({}),flush:()=>{},clientWaitSync:()=>4,deleteSync:vi.fn()} as unknown as WebGL2RenderingContext;await expect(completeDetailCommands(gl)).rejects.toThrow('DETAIL_FENCE_UNCONFIRMED');expect(gl.deleteSync).toHaveBeenCalledOnce();
});
it('does not reveal a returned canvas after a later scope or a skipped gallery draw',async()=>{
 const {revealAfterGalleryDraw}=await import('./detail-command-completion');let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let epoch=1;const reveal=vi.fn(),first=revealAfterGalleryDraw({draw:()=>true,complete:()=>pending,current:()=>epoch===1,reveal});epoch=2;release();expect(await first).toBe(false);expect(reveal).not.toHaveBeenCalled();const fence=vi.fn(async()=>{});expect(await revealAfterGalleryDraw({draw:()=>false,complete:fence,current:()=>true,reveal})).toBe(false);expect(fence).not.toHaveBeenCalled();expect(reveal).not.toHaveBeenCalled();
});
it('hands an existing detail reservation through framebuffer restoration without a release gap',async()=>{
 const {restoreDetailCanvas}=await import('./detail-command-completion');const {AssetPeakBudget}=await import('./loading');let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve});const peak=new AssetPeakBudget(100,()=>20),reveal=vi.fn();peak.reserve('held',70);const restore=restoreDetailCanvas({peak,key:'held',heldBytes:70,requiredBytes:30,limit:100,draw:()=>true,complete:()=>pending,current:()=>true,reveal});expect(peak.total()).toBe(90);finish();await restore;expect(peak.total()).toBe(20);expect(reveal).toHaveBeenCalledOnce();
 peak.reserve('uncertain',70);await expect(restoreDetailCanvas({peak,key:'uncertain',heldBytes:70,requiredBytes:30,limit:100,draw:()=>true,complete:async()=>{throw Error('lost')},current:()=>true,reveal})).rejects.toThrow('lost');expect(peak.total()).toBe(90);
});
it('keeps the transferred hold if scene accounting grows beyond its cap during the fence',async()=>{
 const {restoreDetailCanvas}=await import('./detail-command-completion');const {AssetPeakBudget}=await import('./loading');let resident=20,done!:()=>void;const fence=new Promise<void>(resolve=>{done=resolve}),peak=new AssetPeakBudget(100,()=>resident);peak.reserve('held',70);const reveal=vi.fn(),restoration=restoreDetailCanvas({peak,key:'held',heldBytes:70,requiredBytes:30,limit:100,draw:()=>true,complete:()=>fence,current:()=>peak.total()<=100,reveal});resident=40;done();await expect(restoration).rejects.toThrow('DETAIL_RESTORE_UNAVAILABLE');expect(peak.reservationBytes('held')).toBe(70);expect(reveal).not.toHaveBeenCalled();
});

function focusFixture(){
 const body={},other={};let current=true,hidden=false,windowFocused=true,connected=true,canvasVisible=true,tabIndex=0,blockedAncestor=false,obstacles:Array<{isConnected:boolean;getClientRects:()=>number[];closest:()=>unknown;visibility:string}>=[];
 const doc={body,activeElement:body,hidden:false,hasFocus:()=>windowFocused,defaultView:{getComputedStyle:(element:{visibility?:string})=>({visibility:element.visibility??(canvasVisible?'visible':'hidden')})},querySelectorAll:()=>obstacles};
 const canvas={ownerDocument:doc,isConnected:true,tabIndex,getClientRects:()=>connected?[1]:[],closest:()=>blockedAncestor?{}:null,focus:vi.fn(()=>{doc.activeElement=canvas;})};
 return {canvas:canvas as unknown as HTMLCanvasElement,doc,body,other,current:()=>current,setCurrent:(v:boolean)=>{current=v;},setHidden:(v:boolean)=>{hidden=v;doc.hidden=hidden;},setWindowFocused:(v:boolean)=>{windowFocused=v;},setConnected:(v:boolean)=>{connected=v;canvas.isConnected=v;},setVisible:(v:boolean)=>{canvasVisible=v;},setTabIndex:(v:number)=>{tabIndex=v;canvas.tabIndex=tabIndex;},setBlockedAncestor:(v:boolean)=>{blockedAncestor=v;},setObstacles:(v:typeof obstacles)=>{obstacles=v;},focus:canvas.focus};
}
it('focuses a returned canvas only when the current, visible page still has body focus',async()=>{
 const {focusRestoredDetailCanvas}=await import('./detail-command-completion'),f=focusFixture();expect(focusRestoredDetailCanvas(f.canvas,f.current)).toBe(true);expect(f.focus).toHaveBeenCalledOnce();expect(f.doc.activeElement).toBe(f.canvas);
 for(const change of ['stale','hidden','background','detached','invisible','not-focusable','inert','other-focus'] as const){const g=focusFixture();if(change==='stale')g.setCurrent(false);if(change==='hidden')g.setHidden(true);if(change==='background')g.setWindowFocused(false);if(change==='detached')g.setConnected(false);if(change==='invisible')g.setVisible(false);if(change==='not-focusable')g.setTabIndex(-1);if(change==='inert')g.setBlockedAncestor(true);if(change==='other-focus')g.doc.activeElement=g.other;expect(focusRestoredDetailCanvas(g.canvas,g.current),change).toBe(false);expect(g.focus).not.toHaveBeenCalled();}
});
it('does not move focus through a visible modal or visitor panel, and ignores a hidden one',async()=>{
 const {focusRestoredDetailCanvas}=await import('./detail-command-completion'),f=focusFixture();const visible={isConnected:true,getClientRects:()=>[1],closest:()=>null,visibility:'visible'};f.setObstacles([visible]);expect(focusRestoredDetailCanvas(f.canvas,f.current)).toBe(false);expect(f.focus).not.toHaveBeenCalled();f.setObstacles([{...visible,getClientRects:()=>[]}]);expect(focusRestoredDetailCanvas(f.canvas,f.current)).toBe(true);
});
it('only attempts the focus fallback after a positive restore fence and reveal',async()=>{
 const {restoreDetailCanvas,focusRestoredDetailCanvas}=await import('./detail-command-completion'),{AssetPeakBudget}=await import('./loading');let done!:()=>void;const fence=new Promise<void>(resolve=>{done=resolve}),peak=new AssetPeakBudget(100,()=>20),f=focusFixture();peak.reserve('held',70);const work=restoreDetailCanvas({peak,key:'held',heldBytes:70,requiredBytes:30,limit:100,draw:()=>true,complete:()=>fence,current:()=>true,reveal:()=>{}}).then(()=>focusRestoredDetailCanvas(f.canvas,f.current));expect(f.focus).not.toHaveBeenCalled();done();expect(await work).toBe(true);expect(f.focus).toHaveBeenCalledOnce();
 const bad=focusFixture();peak.reserve('bad',70);await expect(restoreDetailCanvas({peak,key:'bad',heldBytes:70,requiredBytes:30,limit:100,draw:()=>true,complete:async()=>{throw Error('fence')},current:()=>true,reveal:()=>{}}).then(()=>focusRestoredDetailCanvas(bad.canvas,bad.current))).rejects.toThrow('fence');expect(bad.focus).not.toHaveBeenCalled();expect(peak.reservationBytes('bad')).toBe(70);
});

it('does not steal focus deliberately moved while the restore fence is pending',async()=>{
 const {restoreDetailCanvas,focusRestoredDetailCanvas}=await import('./detail-command-completion'),{AssetPeakBudget}=await import('./loading');let done!:()=>void;const fence=new Promise<void>(resolve=>{done=resolve}),peak=new AssetPeakBudget(100,()=>20),f=focusFixture();peak.reserve('held',70);const work=restoreDetailCanvas({peak,key:'held',heldBytes:70,requiredBytes:30,limit:100,draw:()=>true,complete:()=>fence,current:()=>true,reveal:()=>{}}).then(()=>focusRestoredDetailCanvas(f.canvas,f.current));f.doc.activeElement=f.other;done();expect(await work).toBe(false);expect(f.focus).not.toHaveBeenCalled();expect(peak.reservationBytes('held')).toBeUndefined();
});

it('retires a disposed canvas after real cleanup without requiring a visual reveal',async()=>{
 const {retireDetailCanvas}=await import('./detail-command-completion');const retire=vi.fn();
 await retireDetailCanvas({cleanup:Promise.resolve(),restoration:Promise.reject(Error('DETAIL_RESTORE_UNAVAILABLE')),commands:()=>undefined,drawAttempted:()=>false,complete:vi.fn(),retire});
 expect(retire).toHaveBeenCalledOnce();
});
it('retirement joins a stale visual result but strictly retains ownership on a failed command fence',async()=>{
 const {retireDetailCanvas}=await import('./detail-command-completion');let done!:()=>void;
 const commands=new Promise<void>(resolve=>{done=resolve;}),retire=vi.fn();
 const restoration=commands.then(()=>{throw Error('DETAIL_RESTORE_UNAVAILABLE');});
 const work=retireDetailCanvas({cleanup:Promise.resolve(),restoration,commands:()=>commands,drawAttempted:()=>true,complete:vi.fn(),retire});
 await Promise.resolve();expect(retire).not.toHaveBeenCalled();done();await work;expect(retire).toHaveBeenCalledOnce();
 const failed=Promise.reject(Error('DETAIL_FENCE_UNCONFIRMED'));void failed.catch(()=>{});retire.mockClear();
 await expect(retireDetailCanvas({cleanup:Promise.resolve(),restoration:failed,commands:()=>failed,drawAttempted:()=>true,complete:vi.fn(),retire})).rejects.toThrow('DETAIL_FENCE_UNCONFIRMED');expect(retire).not.toHaveBeenCalled();
});
it('retirement fences a partly submitted draw if visual restoration failed before registering completion',async()=>{
 const {retireDetailCanvas}=await import('./detail-command-completion');const events:string[]=[];
 await retireDetailCanvas({cleanup:Promise.resolve(),restoration:Promise.reject(Error('draw')),commands:()=>undefined,drawAttempted:()=>true,complete:async()=>{events.push('fence');},retire:()=>{events.push('release');}});
 expect(events).toEqual(['fence','release']);
});
