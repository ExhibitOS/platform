// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import * as three from 'three';
import {prepareArtwork} from './artwork-preparation';
import {AssetScheduler} from './loading';
afterEach(()=>vi.useRealTimers());
function setup(parallel=true){
  vi.useFakeTimers();
  const canvas=Object.assign(new EventTarget(),{ownerDocument:{hidden:false}});
  const texture=new three.Texture(),material=new three.MeshStandardMaterial({map:texture,normalMap:texture});
  const object=new three.Group();object.add(new three.Mesh(new three.BoxGeometry(),material),new three.Mesh(new three.BoxGeometry(),material));
  const a={program:{} as WebGLProgram,isReady:vi.fn(()=>true)},b={program:{} as WebGLProgram,isReady:vi.fn(()=>true)};
  const state={programs:new Map([['front',a],['back',b]])};
  const renderer={domElement:canvas,getContext:()=>({isContextLost:()=>false}),initTexture:vi.fn(),compile:vi.fn(()=>new Set([material])),extensions:{has:()=>parallel},properties:{get:()=>state}};
  const abort=new AbortController();let unavailable=false;
  const run=(timeout=15000)=>prepareArtwork(three,renderer as unknown as three.WebGLRenderer,object,new three.PerspectiveCamera(),new three.Scene(),abort.signal,()=>unavailable,timeout);
  return {canvas,renderer,a,b,state,abort,run,stop:()=>{unavailable=true;}};
}
it('yields before unique uploads and compile; captures all r186 variants without drawing',async()=>{
  const h=setup();const pending=h.run();
  expect(h.renderer.initTexture).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({textures:1,programs:2,shaderCompletion:'tracked',geometry:'awaits-draw'});
  expect(h.renderer.initTexture).toHaveBeenCalledTimes(1);expect(h.renderer.compile).toHaveBeenCalledTimes(1);
  expect(h.a.isReady).toHaveBeenCalledTimes(1);expect(h.b.isReady).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('waits for captured variants even when the material map changes during rendering',async()=>{
  const h=setup();h.b.isReady.mockReturnValue(false);const pending=h.run();
  await vi.advanceTimersByTimeAsync(5);h.state.programs=new Map([['different',h.a]]);
  await vi.advanceTimersByTimeAsync(30);expect(h.b.isReady).toHaveBeenCalled();
  h.b.isReady.mockReturnValue(true);await vi.runAllTimersAsync();expect((await pending).programs).toBe(2);
});
it('reports unavailable completion tracking without querying native readiness',async()=>{
  const h=setup(false),pending=h.run();await vi.runAllTimersAsync();
  expect((await pending).shaderCompletion).toBe('unavailable');expect(h.a.isReady).not.toHaveBeenCalled();
});
it('does not upload while the document is hidden, then resumes when visible',async()=>{
  const h=setup();h.canvas.ownerDocument.hidden=true;const pending=h.run();
  await vi.advanceTimersByTimeAsync(200);expect(h.renderer.initTexture).not.toHaveBeenCalled();
  h.canvas.ownerDocument.hidden=false;await vi.runAllTimersAsync();await pending;
  expect(h.renderer.initTexture).toHaveBeenCalledTimes(1);
});
it('aborts polling immediately and removes its timer and lifecycle listeners',async()=>{
  const h=setup();h.b.isReady.mockReturnValue(false);
  const remove=vi.spyOn(h.canvas,'removeEventListener');const pending=h.run();const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await vi.advanceTimersByTimeAsync(20);h.abort.abort();await rejected;
  expect(vi.getTimerCount()).toBe(0);expect(remove).toHaveBeenCalledWith('webglcontextlost',expect.any(Function));
});
it.each(['lost','disposed','timeout','query-throws'] as const)('settles %s without leaving polling work',async reason=>{
  const h=setup();h.b.isReady.mockReturnValue(false);
  const pending=h.run(reason==='timeout'?30:15000);const rejected=expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5);
  if(reason==='lost')h.canvas.dispatchEvent(new Event('webglcontextlost'));
  if(reason==='disposed')h.stop();
  if(reason==='query-throws')h.a.isReady.mockImplementation(()=>{throw Error('driver query');});
  await vi.runAllTimersAsync();await rejected;expect(vi.getTimerCount()).toBe(0);
});
it('never queries a destroyed native program',async()=>{
  const h=setup();const pending=h.run();const rejected=expect(pending).rejects.toThrow('PROGRAM_DISPOSED');
  await vi.advanceTimersByTimeAsync(5);h.a.program=undefined as unknown as WebGLProgram;
  await vi.runAllTimersAsync();await rejected;expect(h.a.isReady).not.toHaveBeenCalled();
});
it('keeps the serial slot until cancellation settles, then starts the next artwork',async()=>{
  const h=setup();h.b.isReady.mockReturnValue(false);
  let firstSettled=false,secondStarted=false;
  const scheduler=new AssetScheduler({concurrency:1,load:async(key,signal)=>{
    if(key==='second'){secondStarted=true;expect(firstSettled).toBe(true);return;}
    try{await prepareArtwork(three,h.renderer as unknown as three.WebGLRenderer,new three.Mesh(new three.BoxGeometry(),new three.MeshBasicMaterial()),new three.Camera(),new three.Scene(),signal,()=>false);}
    finally{firstSettled=true;}
  }});
  const first=scheduler.request('first');const rejected=expect(first).rejects.toThrow();
  const second=scheduler.request('second');await vi.advanceTimersByTimeAsync(20);
  expect(secondStarted).toBe(false);scheduler.cancel('first');await rejected;await second;
  expect(secondStarted).toBe(true);expect(vi.getTimerCount()).toBe(0);scheduler.dispose();
});
