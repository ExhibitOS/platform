// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {waitHayesReadyFrame} from './hayes-ready-wait.ts';
afterEach(()=>vi.useRealTimers());
it('uses the operation budget for idle ready and accepts a frame after five seconds',async()=>{
 vi.useFakeTimers();const close=vi.fn(async()=>{}),receive=vi.fn(async()=>{await new Promise(r=>setTimeout(r,6000));return Buffer.from('ready');}),deadline=Date.now()+10000;
 const pending=waitHayesReadyFrame({receive,close},new AbortController().signal,deadline);expect(receive).toHaveBeenCalledWith(10000);await vi.advanceTimersByTimeAsync(6000);expect(Buffer.from(await pending).toString()).toBe('ready');expect(close).not.toHaveBeenCalled();
});
it('closes on cancellation or absolute expiry even when a partial frame is pending',async()=>{
 vi.useFakeTimers();const close=vi.fn(async()=>{}),receive=vi.fn(()=>new Promise<Uint8Array>(()=>{})),controller=new AbortController(),pending=waitHayesReadyFrame({receive,close},controller.signal,Date.now()+9000),rejection=expect(pending).rejects.toThrow();controller.abort();await rejection;expect(close).toHaveBeenCalledTimes(1);
 const close2=vi.fn(async()=>{}),late=waitHayesReadyFrame({receive,close:close2},new AbortController().signal,Date.now()+7000),lateRejection=expect(late).rejects.toThrow();await vi.advanceTimersByTimeAsync(7000);await lateRejection;expect(close2).toHaveBeenCalledTimes(1);
});
it('initiates one close for already-aborted and already-expired waits',async()=>{
 const receive=vi.fn(()=>new Promise<Uint8Array>(()=>{})),close=vi.fn(async()=>{}),controller=new AbortController();controller.abort();
 await expect(waitHayesReadyFrame({receive,close},controller.signal,Date.now()+1000)).rejects.toThrow();expect(close).toHaveBeenCalledTimes(1);expect(receive).not.toHaveBeenCalled();
 const other=vi.fn(async()=>{});await expect(waitHayesReadyFrame({receive,close:other},new AbortController().signal,Date.now()-1)).rejects.toThrow();expect(other).toHaveBeenCalledTimes(1);expect(receive).not.toHaveBeenCalled();
});
it('rejects a frame arriving at the absolute deadline',async()=>{
 vi.useFakeTimers();const close=vi.fn(async()=>{}),receive=vi.fn(async()=>{await new Promise(r=>setTimeout(r,7000));return Buffer.from('late');}),pending=waitHayesReadyFrame({receive,close},new AbortController().signal,Date.now()+7000),rejection=expect(pending).rejects.toThrow();
 await vi.advanceTimersByTimeAsync(7000);await rejection;expect(close).toHaveBeenCalledTimes(1);
});
