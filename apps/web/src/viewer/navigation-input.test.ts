// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, expect, test, vi } from 'vitest';
import { createWalkingInput } from './navigation-input';
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const doc = Object.assign(new EventTarget(), { activeElement: null as unknown, pointerLockElement: null as unknown, hidden:false, exitPointerLock:vi.fn(() => {doc.pointerLockElement=null;}) });
  const canvas = Object.assign(new EventTarget(), { focus:()=>{doc.activeElement=canvas;}, requestPointerLock:vi.fn<()=>Promise<void>>(), getBoundingClientRect:()=>({left:0,width:100}),setPointerCapture:vi.fn() });
  vi.stubGlobal('document',doc);vi.stubGlobal('window',new EventTarget());
  const pause=vi.fn(),error=vi.fn(),input=createWalkingInput(canvas as unknown as HTMLCanvasElement,pause,error);
  input.enable();return {doc,canvas,input,pause,error};
}
test('pending capture after pause then resume releases stale native lock',async()=>{
  const {doc,canvas,input}=fixture();let finish!:()=>void;
  canvas.requestPointerLock.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
  const pending=input.capture();input.pause();input.enable();doc.pointerLockElement=canvas;finish();await pending;
  expect(doc.exitPointerLock).toHaveBeenCalledOnce();input.dispose();
});
test('disposed pending capture releases native lock and suppresses stale rejection',async()=>{
  const {doc,canvas,input,error}=fixture();let finish!:()=>void;
  canvas.requestPointerLock.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
  const pending=input.capture();input.dispose();doc.pointerLockElement=canvas;finish();await pending;
  expect(doc.exitPointerLock).toHaveBeenCalledOnce();expect(error).not.toHaveBeenCalled();
});
test('touch movement tokens release independently and pause clears all held movement',()=>{
  const {input}=fixture();input.press('forward',1);input.press('right',2);
  expect(input.sample(.01)).toMatchObject({forward:1,right:1});input.release(1);
  expect(input.sample(.01)).toMatchObject({forward:0,right:1});input.pause();input.enable();
  expect(input.sample(.01)).toMatchObject({forward:0,right:0});input.dispose();
});
