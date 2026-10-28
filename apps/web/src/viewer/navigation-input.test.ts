// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, expect, test, vi } from 'vitest';
import { createWalkingInput } from './navigation-input';
afterEach(() => vi.unstubAllGlobals());
function fixture(resume?: () => boolean) {
  const doc = Object.assign(new EventTarget(), { activeElement: null as unknown, pointerLockElement: null as unknown, hidden:false, exitPointerLock:vi.fn(() => {doc.pointerLockElement=null;}) });
  const canvas = Object.assign(new EventTarget(), { focus:vi.fn(()=>{doc.activeElement=canvas;}), requestPointerLock:vi.fn<()=>Promise<void> | void>(), getBoundingClientRect:()=>({left:0,width:100}),setPointerCapture:vi.fn() });
  vi.stubGlobal('document',doc);vi.stubGlobal('window',new EventTarget());
  const pause=vi.fn(),error=vi.fn(),input=createWalkingInput(canvas as unknown as HTMLCanvasElement,pause,error,undefined,resume);
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
test('manual mouse drag looks without pointer lock and release or pause clears the gesture',()=>{
  const {input,canvas,doc}=fixture();
  const pointer=(type:string,x:number,y:number)=>canvas.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:7,pointerType:'mouse',button:0,clientX:x,clientY:y}));
  pointer('pointerdown',20,20);pointer('pointermove',30,25);
  expect(input.sample(.01)).toMatchObject({yawDelta:-.04,pitchDelta:-.02});
  expect(doc.pointerLockElement).toBeNull();expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  pointer('pointerup',30,25);pointer('pointermove',50,40);
  expect(input.sample(.01)).toMatchObject({yawDelta:0,pitchDelta:0});
  pointer('pointerdown',20,20);input.pause();input.enable();pointer('pointermove',50,40);
  expect(input.sample(.01)).toMatchObject({yawDelta:0,pitchDelta:0});input.dispose();
});
test('active touch controls keep canvas focus without reviving paused input',()=>{
  const {input,canvas,doc,pause}=fixture();
  canvas.focus.mockClear(); input.press('forward',1);
  expect(canvas.focus).toHaveBeenCalledWith({preventScroll:true});
  expect(doc.activeElement).toBe(canvas);
  expect(input.sample(.1).forward).toBe(1);
  canvas.dispatchEvent(new Event('blur'));
  expect(pause).toHaveBeenCalledOnce();
  canvas.focus.mockClear(); input.press('right',2);
  expect(canvas.focus).not.toHaveBeenCalled();
  expect(input.sample(.1)).toEqual({forward:0,right:0,yawDelta:0,pitchDelta:0});
  canvas.focus();
  expect(input.sample(.1).forward).toBe(0);
  input.enable(); input.press('right',2);
  expect(input.sample(.1).right).toBe(1); input.dispose();
});
test('panel pause carries its reason and resume clears held input without capturing the pointer',()=>{
  const {input,canvas,pause}=fixture();
  input.press('forward',1); input.press('turn-left',2);
  input.pause('panel');
  expect(pause).toHaveBeenLastCalledWith('panel');
  input.enable();
  expect(input.sample(.1)).toEqual({forward:0,right:0,yawDelta:0,pitchDelta:0});
  expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('blur'));
  expect(pause).toHaveBeenLastCalledWith('window');
  input.dispose();
});
test('vertical touch look combines with movement and releases each pointer independently',()=>{
  const {input}=fixture(); input.press('forward',1); input.press('look-up',2);
  expect(input.sample(.1)).toMatchObject({forward:1,pitchDelta:.12});
  input.release(2); expect(input.sample(.1)).toMatchObject({forward:1,pitchDelta:0});
  input.press('look-down',3);expect(input.sample(.1).pitchDelta).toBe(-.12);
  input.press('look-up',4);expect(input.sample(.1).pitchDelta).toBe(0);
  input.pause();input.enable();
  expect(input.sample(.1)).toEqual({forward:0,right:0,yawDelta:0,pitchDelta:0});
  input.dispose();
});

test('legacy void capture stays pending until a document failure and reports once', async () => {
  const { doc, canvas, input, error } = fixture();
  canvas.requestPointerLock.mockImplementation(() => undefined);
  let completed = false;
  const pending = input.capture().then(() => { completed = true; });
  await Promise.resolve();
  expect(completed).toBe(false);
  doc.dispatchEvent(new Event('pointerlockerror'));
  await pending;
  expect(error).toHaveBeenCalledOnce();
  doc.dispatchEvent(new Event('pointerlockerror'));
  expect(error).toHaveBeenCalledOnce();
  input.dispose();
});
test('legacy success settles and permits mouse look only with real document lock', async () => {
  const { doc, canvas, input, error } = fixture();
  canvas.requestPointerLock.mockImplementation(() => undefined);
  const pending = input.capture();
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  await pending;
  const move = Object.assign(new Event('mousemove'), { movementX: 10, movementY: 5 });
  window.dispatchEvent(move);
  expect(input.sample(.01)).toMatchObject({ yawDelta: -.02, pitchDelta: -.01 });
  expect(error).not.toHaveBeenCalled();
  input.dispose();
});
test('legacy late success after pause and resume releases stale lock without pausing renewed keyboard input', async () => {
  const { doc, canvas, input, error, pause } = fixture();
  canvas.requestPointerLock.mockImplementation(() => undefined);
  const pending = input.capture();
  input.pause();
  input.enable();
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  await pending;
  expect(doc.exitPointerLock).toHaveBeenCalledOnce();
  expect(error).not.toHaveBeenCalled();
  input.press('forward', 1);
  expect(input.sample(.01).forward).toBe(1);
  expect(pause).toHaveBeenCalledOnce();
  input.dispose();
});
test('legacy pending disposal retains guards until late success and then removes them', async () => {
  const { doc, canvas, input, error } = fixture();
  const remove = vi.spyOn(doc, 'removeEventListener');
  canvas.requestPointerLock.mockImplementation(() => undefined);
  const pending = input.capture();
  input.dispose();
  const before = remove.mock.calls.length;
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  await pending;
  expect(doc.exitPointerLock).toHaveBeenCalledOnce();
  expect(error).not.toHaveBeenCalled();
  expect(remove.mock.calls.length).toBe(before + 2);
});
test('stale legacy rejection after disposal is suppressed', async () => {
  const { doc, canvas, input, error } = fixture();
  canvas.requestPointerLock.mockImplementation(() => undefined);
  const pending = input.capture();
  input.dispose();
  doc.dispatchEvent(new Event('pointerlockerror'));
  await pending;
  expect(error).not.toHaveBeenCalled();
});
test('document error plus Promise rejection reports the same failure once', async () => {
  const { doc, canvas, input, error } = fixture();
  let reject!: (reason: Error) => void;
  canvas.requestPointerLock.mockImplementation(() => new Promise<void>((_, r) => { reject = r; }));
  const pending = input.capture();
  doc.dispatchEvent(new Event('pointerlockerror'));
  reject(new Error('denied'));
  await pending;
  await Promise.resolve();
  expect(error).toHaveBeenCalledOnce();
  input.dispose();
});
test('pending request prevents overlapping native requests even after pause and resume', async () => {
  const { doc, canvas, input } = fixture();
  canvas.requestPointerLock.mockImplementation(() => undefined);
  const pending = input.capture();
  input.pause();
  input.enable();
  await input.capture();
  expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
  doc.dispatchEvent(new Event('pointerlockerror'));
  await pending;
  const retry = input.capture();
  expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
  doc.dispatchEvent(new Event('pointerlockerror'));
  await retry;
  input.dispose();
});
test('old Promise completion after event settlement cannot release a newer capture', async () => {
  const { doc, canvas, input } = fixture();
  let oldFinish!: () => void, newFinish!: () => void;
  canvas.requestPointerLock.mockImplementationOnce(() => new Promise<void>(r => { oldFinish = r; })).mockImplementationOnce(() => new Promise<void>(r => { newFinish = r; }));
  const old = input.capture();
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  await old;
  input.pause();
  input.enable();
  const fresh = input.capture();
  doc.pointerLockElement = canvas;
  oldFinish();
  await Promise.resolve();
  expect(doc.pointerLockElement).toBe(canvas);
  expect(doc.exitPointerLock).toHaveBeenCalledOnce();
  newFinish();
  await fresh;
  expect(doc.pointerLockElement).toBe(canvas);
  input.dispose();
});
test('synchronous request failure reports and cleans up so a subsequent request can succeed', async () => {
  const { doc, canvas, input, error } = fixture();
  canvas.requestPointerLock.mockImplementationOnce(() => { throw new Error('unsupported'); }).mockImplementationOnce(() => undefined);
  await input.capture();
  expect(error).toHaveBeenCalledOnce();
  const retry = input.capture();
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  await retry;
  expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
  input.dispose();
});
test('queued unlock after explicit pause does not pause a renewed session, while new lock loss does', async () => {
  const { doc, canvas, input, pause } = fixture();
  canvas.requestPointerLock.mockImplementation(() => undefined);
  const pending = input.capture();
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  await pending;
  input.pause();
  input.enable();
  doc.dispatchEvent(new Event('pointerlockchange'));
  input.press('forward', 1);
  expect(input.sample(.01).forward).toBe(1);
  expect(pause).toHaveBeenCalledOnce();
  const fresh = input.capture();
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  await fresh;
  doc.pointerLockElement = null;
  doc.dispatchEvent(new Event('pointerlockchange'));
  expect(input.sample(.01).forward).toBe(0);
  expect(pause).toHaveBeenCalledTimes(2);
  input.dispose();
});

test('Escape explicitly releases owned native capture and clears movement without browser auto-release', async () => {
  const { doc, canvas, input, pause } = fixture();
  canvas.requestPointerLock.mockImplementation(() => undefined);
  const pending = input.capture();
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  await pending;
  input.press('forward', 1);
  window.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 10, movementY: 5 }));
  // Synthetic key delivery does not perform the browser's native Escape release.
  window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
  expect(doc.exitPointerLock).toHaveBeenCalledOnce();
  expect(doc.pointerLockElement).toBeNull();
  expect(pause).toHaveBeenCalledOnce();
  expect(input.sample(.01)).toEqual({ forward: 0, right: 0, yawDelta: 0, pitchDelta: 0 });
  doc.dispatchEvent(new Event('pointerlockchange'));
  expect(pause).toHaveBeenCalledOnce();
  input.enable();
  expect(input.sample(.01).forward).toBe(0);
  input.dispose();
});

test('same Q/W/E/A/S/D event resumes and retains its existing action; release clears it',()=>{
 for(const code of ['KeyQ','KeyW','KeyE','KeyA','KeyS','KeyD']){
  const resume=vi.fn<()=>boolean>(()=>{f.input.enable();return true;});const f=fixture(resume);f.input.pause('panel');
  window.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code}));
  expect(resume).toHaveBeenCalledOnce();const value=f.input.sample(.1);
  expect(Object.values(value).some(v=>v!==0)).toBe(true);
  window.dispatchEvent(Object.assign(new Event('keyup'),{code}));
  expect(f.input.sample(.1)).toEqual({forward:0,right:0,yawDelta:0,pitchDelta:0});f.input.dispose();
 }
});
test('IME, shortcuts, repeat and non-resume keys never start a paused session',()=>{
 const resume=vi.fn(()=>false),f=fixture(resume);f.input.pause('panel');
 for(const fields of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{keyCode:229},{repeat:true},{code:'ArrowUp'}]){
  window.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code:'KeyW',...fields}));
 }
 expect(resume).not.toHaveBeenCalled();f.input.dispose();
});
test('Shift preserves movement, and background entry never resumes',()=>{
 const resume=vi.fn<()=>boolean>(()=>{f.input.enable();return true;});const f=fixture(resume);f.input.pause('panel');
 f.doc.hidden=true;window.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyW'}));expect(resume).not.toHaveBeenCalled();
 f.doc.hidden=false;window.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyW',shiftKey:true}));
 expect(f.input.sample(.1).forward).toBe(1);window.dispatchEvent(new Event('blur'));expect(f.input.sample(.1).forward).toBe(0);f.input.dispose();
});
test('first right touch resumes existing drag and retains the same captured pointer',()=>{
 const resume=vi.fn<()=>boolean>(()=>{f.input.enable();return true;});const f=fixture(resume);f.input.pause('panel');
 const pointer=(type:string,x:number)=>f.canvas.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:8,pointerType:'touch',button:0,clientX:x,clientY:20}));
 pointer('pointerdown',70);expect(resume).not.toHaveBeenCalled();pointer('pointermove',80);expect(resume).toHaveBeenCalledOnce();expect(f.canvas.setPointerCapture).toHaveBeenCalledWith(8);
 expect(f.input.sample(.1).yawDelta).toBe(-.04);pointer('pointercancel',80);pointer('pointermove',90);expect(f.input.sample(.1).yawDelta).toBe(0);f.input.dispose();
});

test('focused controls and editable event targets retain their keys without resuming',()=>{
 class Control extends EventTarget {closest(){return this;}}
 vi.stubGlobal('Element',Control);
 const resume=vi.fn(()=>false),f=fixture(resume);f.input.pause('panel');
 f.doc.activeElement=new Control();window.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyW'}));
 expect(resume).not.toHaveBeenCalled();f.input.dispose();
});

test('a fresh mapped key after Esc resumes in the same event without native recapture',()=>{
 const resume=vi.fn<()=>boolean>(()=>{f.input.enable();return true;});const f=fixture(resume);
 f.input.press('forward',1);window.dispatchEvent(Object.assign(new Event('keydown'),{code:'Escape'}));
 expect(f.input.sample(.1).forward).toBe(0);expect(resume).not.toHaveBeenCalled();
 window.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code:'KeyD'}));
 expect(resume).toHaveBeenCalledOnce();expect(f.input.sample(.1).right).toBe(1);
 expect(f.canvas.requestPointerLock).not.toHaveBeenCalled();
 window.dispatchEvent(Object.assign(new Event('keyup'),{code:'KeyD'}));expect(f.input.sample(.1).right).toBe(0);f.input.dispose();
});


test('held keys and leftover look never return after a temporary pause is cleared',()=>{
 const f=fixture();const key=(type:string,repeat=false)=>window.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{code:'KeyW',repeat}));
 key('keydown');expect(f.input.sample(.1).forward).toBe(1);f.input.pause('panel');f.input.enable();key('keydown',true);expect(f.input.sample(.1).forward).toBe(0);
 key('keyup');key('keydown');expect(f.input.sample(.1).forward).toBe(1);f.input.dispose();
});
test('paused taps, cancelled pointers and multitouch do not consume resume',()=>{
 const resume=vi.fn<()=>boolean>(()=>{f.input.enable();return true;});const f=fixture(resume);f.input.pause('escape');
 const pointer=(type:string,fields={})=>f.canvas.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:8,pointerType:'touch',button:0,clientX:70,clientY:20,...fields}));
 pointer('pointerdown');pointer('pointerup');expect(resume).not.toHaveBeenCalled();
 pointer('pointerdown');pointer('pointercancel');pointer('pointermove',{clientX:90});expect(resume).not.toHaveBeenCalled();
 pointer('pointerdown');pointer('pointerdown',{pointerId:9,isPrimary:false});pointer('pointermove',{clientX:90});expect(resume).not.toHaveBeenCalled();
 pointer('pointerdown');pointer('pointermove',{clientX:90});expect(resume).toHaveBeenCalledOnce();
 expect(f.input.sample(.1).yawDelta).toBe(-.08);f.input.dispose();
});
test('a joystick held in active walking permits the existing second-hand look without another resume',()=>{
 const resume=vi.fn(()=>false),f=fixture(resume);f.input.press('forward',1);
 f.canvas.dispatchEvent(Object.assign(new Event('pointerdown',{cancelable:true}),{pointerId:2,pointerType:'touch',isPrimary:false,button:0,clientX:70,clientY:20}));
 f.canvas.dispatchEvent(Object.assign(new Event('pointermove',{cancelable:true}),{pointerId:2,clientX:80,clientY:20}));
 expect(f.input.sample(.1)).toMatchObject({forward:1,yawDelta:-.04});expect(resume).not.toHaveBeenCalled();f.input.dispose();
});


test('fresh non-repeat input after a release outside the app works on the first press',()=>{
 const f=fixture();const key=(repeat:boolean)=>window.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code:'KeyW',repeat}));
 key(false);f.input.pause('window');f.input.enable();key(true);expect(f.input.sample(.1).forward).toBe(0);
 key(false);expect(f.input.sample(.1).forward).toBe(1);f.input.dispose();
});
test('shortcut-modified pending look does not resume, including modifiers applied after down',()=>{
 for(const modifier of ['ctrlKey','metaKey','altKey']){
  const resume=vi.fn(()=>false),f=fixture(resume);f.input.pause('escape');
  const pointer=(type:string,fields={})=>f.canvas.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:8,pointerType:'mouse',button:0,clientX:70,clientY:20,...fields}));
  pointer('pointerdown',{[modifier]:true});pointer('pointermove',{clientX:90});expect(resume).not.toHaveBeenCalled();
  pointer('pointerdown');pointer('pointermove',{clientX:90,[modifier]:true});pointer('pointermove',{clientX:100});expect(resume).not.toHaveBeenCalled();f.input.dispose();
 }
});


test('a key first held during a panel pause cannot introduce movement through later repeat',()=>{
 const f=fixture(()=>false);f.input.pause('panel');const key=(repeat:boolean)=>window.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code:'KeyW',repeat}));
 key(false);f.input.enable();key(true);expect(f.input.sample(.1).forward).toBe(0);
 window.dispatchEvent(Object.assign(new Event('keyup'),{code:'KeyW'}));key(false);expect(f.input.sample(.1).forward).toBe(1);f.input.dispose();
});
