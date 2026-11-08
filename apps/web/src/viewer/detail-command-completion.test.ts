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
