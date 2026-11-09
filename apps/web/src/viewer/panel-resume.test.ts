// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, expect, test, vi } from "vitest";
import { createPanelResumeGate,createPanelDismissalGesture,installPanelResume,installPanelDismissal,panelEscapeFromControl } from "./panel-resume";
afterEach(()=>vi.unstubAllGlobals());

function panelPaused() {
  const gate = createPanelResumeGate();
  gate.mode(true, false);
  gate.mode(true, true, "panel");
  return gate;
}
function click(gate: ReturnType<typeof createPanelResumeGate>, allowed = true) {
  gate.begin(1, 20, 30, allowed);
  gate.end(1, 20, 30, true);
  return gate.consume(20, 30, allowed);
}
test("only a distinct empty-space click can consume an active panel pause once", () => {
  const gate = panelPaused();
  expect(gate.consume(20, 30, true)).toBe(false); // opening event has no canvas gesture
  expect(click(gate, false)).toBe(false); // panel, artwork, or other interaction
  expect(click(gate)).toBe(true);
  expect(click(gate)).toBe(false);
});
test("background stops retain existing eligibility but cannot create it", () => {
  for (const reason of ["window", "hidden", "blur"] as const) {
    const gate = createPanelResumeGate(); gate.mode(true, false); gate.background();
    gate.mode(true, true, reason);
    expect(gate.movement(false)).toBe(false);
    expect(gate.movement(true)).toBe(true);
    const stopped = createPanelResumeGate(); stopped.background(); stopped.mode(true, true, reason);
    expect(stopped.movement(true)).toBe(false);
  }
  const stationary = createPanelResumeGate();
  stationary.mode(false, true, "panel");
  expect(click(stationary)).toBe(false);
});
test("backgrounding a panel pause cannot resume merely by closing the panel", () => {
  for (const reason of ["window", "hidden", "blur"] as const) {
    for (const eventFirst of [true, false]) {
      const gate = panelPaused();
      if (eventFirst) gate.background();
      gate.mode(true, true, reason);
      if (!eventFirst) gate.background();
      expect(gate.panelClosed()).toBe(false);
      expect(gate.movement(false)).toBe(false);
      expect(gate.movement(true)).toBe(true);
    }
  }
});
test("bench return preserves fresh input but neither a held gesture nor explicit pause", () => {
 const eligible=panelPaused();expect(eligible.wasWalkingBeforeSeat()).toBe(true);
 const earlier=eligible.intent();
 eligible.mode(false,true);eligible.mode(true,true,"bench-return");
 expect(eligible.isBenchReturn()).toBe(true);
 expect(eligible.panelClosed()).toBe(false);expect(earlier(true)).toBe(false);
 expect(eligible.movement(false)).toBe(false);expect(eligible.movement(true)).toBe(true);
 const stopped=panelPaused();stopped.mode(true,true,"user");stopped.mode(true,true,"panel");
 expect(stopped.wasWalkingBeforeSeat()).toBe(false);
});
test("a second seat preserves an unconsumed bench return but respects an explicit stop", () => {
 const gate=createPanelResumeGate();
 gate.mode(true,false);
 for(let cycle=0;cycle<2;cycle++){
  expect(gate.wasWalkingBeforeSeat()).toBe(true);
  gate.mode(false,true);
  gate.mode(true,true,"bench-return");
 }
 expect(gate.movement(true)).toBe(true);
 gate.mode(true,true,"bench-return");
 gate.mode(true,true,"escape");
 expect(gate.wasWalkingBeforeSeat()).toBe(false);
});
test("bench return cannot consume input while a panel or modal is still open", () => {
 let panel=true,modal=false;
 const root=Object.assign(new EventTarget(),{querySelectorAll:()=>panel?[{open:true}]:[],querySelector:()=>modal?{}:null});
 const canvas={isConnected:true,style:{visibility:''},closest:(selector:string)=>selector==='.publication-shell'?root:null};
 vi.stubGlobal("document",Object.assign(new EventTarget(),{hidden:false}));
 vi.stubGlobal("window",new EventTarget());
 const resume=vi.fn(),handler=installPanelResume(canvas as unknown as HTMLCanvasElement,vi.fn(),resume);
 handler.mode(true,true,"bench-return");
 expect(handler.drag(true)).toBe(false);expect(handler.movement(true)).toBe(false);
 panel=false;modal=true;
 expect(handler.drag(true)).toBe(false);expect(handler.movement(true)).toBe(false);
 modal=false;expect(handler.drag(true)).toBe(true);expect(resume).toHaveBeenCalledOnce();
 handler.dispose();
});
test("owns touch focus before a sit button can blur the same gallery canvas", () => {
 const root=Object.assign(new EventTarget(),{querySelectorAll:()=>[],querySelector:()=>null});
 const canvas={isConnected:true,style:{visibility:''},closest:(selector:string)=>selector==='.publication-shell'?root:null};
 const doc=Object.assign(new EventTarget(),{hidden:false});
 vi.stubGlobal('document',doc);
 vi.stubGlobal('window',new EventTarget());
 class SitButton extends EventTarget {
  constructor(private sameGallery:boolean){super();}
  closest(selector:string){
   if(selector==='button[data-bench-action][data-bench-seated="false"]')return this;
   return selector==='.geometry-preview'?{contains:()=>this.sameGallery}:null;
  }
 }
 vi.stubGlobal('Element',SitButton);
 const pause=vi.fn(()=>handler.mode(true,true,'panel'));
 const handler=installPanelResume(canvas as unknown as HTMLCanvasElement,pause,vi.fn());
 const down=(sameGallery:boolean)=>{
  const event=Object.assign(new Event('pointerdown'),{pointerId:1,isPrimary:true,button:0});
  Object.defineProperties(event,{isTrusted:{value:true},target:{value:new SitButton(sameGallery)}});
  doc.dispatchEvent(event);
 };
 handler.mode(true,false);
 down(false);
 expect(pause).not.toHaveBeenCalled();
 down(true);
 expect(pause).toHaveBeenCalledOnce();
 expect(handler.isPanelFocus(null)).toBe(true);
 expect(handler.wasWalkingBeforeSeat()).toBe(true);
 handler.mode(true,true,'escape');
 down(true);
 expect(handler.wasWalkingBeforeSeat()).toBe(false);
 handler.dispose();
});
test("drag returning to start, cancellation, and release outside canvas reject resume", () => {
  const gate = panelPaused();
  gate.begin(1, 20, 30, true); gate.move(1, 40, 30); gate.move(1, 20, 30); gate.end(1, 20, 30, true);
  expect(gate.consume(20, 30, true)).toBe(false);
  gate.begin(1, 20, 30, true); gate.cancel(); gate.end(1, 20, 30, true);
  expect(gate.consume(20, 30, true)).toBe(false);
  gate.begin(1, 20, 30, true); gate.end(1, 20, 30, false);
  expect(gate.consume(20, 30, true)).toBe(false);
  expect(click(gate)).toBe(true); // a later deliberate tap is still available
});
test("panel settings preserve eligibility but never create it for stopped walking", () => {
  const gate = panelPaused(); gate.mode(true, true, "settings");
  expect(click(gate)).toBe(true);
  gate.mode(true, true, "settings"); gate.mode(true, true, "panel");
  expect(click(gate)).toBe(false);
});
test("tab-away, modal, error, or closed-panel invalidation rejects pending clicks", () => {
  const gate = panelPaused(); gate.begin(1, 20, 30, true); gate.end(1, 20, 30, true);
  gate.invalidate();
  expect(gate.consume(20, 30, true)).toBe(false);
  expect(click(gate)).toBe(false);
});

test("movement consumes an eligible session only once", () => {
 const gate=panelPaused();expect(gate.canResume()).toBe(true);
 expect(gate.movement(false)).toBe(false);expect(gate.movement(true)).toBe(true);
 expect(gate.movement(true)).toBe(false);expect(click(gate)).toBe(false);
 for(const reason of ["window","hidden","blur"] as const){
  const stopped=panelPaused();stopped.mode(true,true,reason);expect(stopped.movement(true)).toBe(true);
 }
});

// Latest explicit-resume policy supersedes the former Esc/user-stop denial only.
test("Esc, explicit pause and native unlock allow only a later deliberate gesture", () => {
 for (const reason of ["escape", "user", "pointerlock"] as const) {
  const gate=createPanelResumeGate(); gate.mode(true,false); gate.mode(true,true,reason);
  expect(gate.canResume()).toBe(true); expect(gate.requiresPanel()).toBe(false);
  expect(gate.consume(20,30,true)).toBe(false); // no prior gesture / no auto resume
  expect(gate.movement(false)).toBe(false); // modal/error/suspended availability
  expect(gate.movement(true)).toBe(true); expect(gate.movement(true)).toBe(false);
  gate.mode(true,false); gate.mode(true,true,reason); expect(click(gate)).toBe(true);
 }
});
test("native unlock and tab-away retain deliberate resume eligibility; stopped modes clear it", () => {
 const gate=createPanelResumeGate();gate.mode(true,false);gate.mode(true,true,"escape");
 gate.mode(true,true,"pointerlock");expect(gate.requiresPanel()).toBe(false);expect(gate.canResume()).toBe(true);
 gate.background();gate.mode(true,true,"window");expect(gate.canResume()).toBe(true);
 gate.mode(false,true,"escape");expect(gate.movement(true)).toBe(false);
});

test("a second Escape cancels a pending click without revoking explicit key resume", () => {
 const gate=createPanelResumeGate();gate.mode(true,false);gate.cancel();gate.mode(true,true,"escape");
 gate.begin(1,20,30,true);gate.end(1,20,30,true);
 gate.cancel(); // the existing document Escape listener, including repeated delivery
 expect(gate.consume(20,30,true)).toBe(false);
 expect(gate.canResume()).toBe(true);expect(gate.movement(true)).toBe(true);
});


test("last panel close releases only the temporary panel cause, once", () => {
 const gate=panelPaused();expect(gate.panelClosed()).toBe(true);expect(gate.panelClosed()).toBe(false);
 for(const reason of ["escape","user"] as const){
  const stopped=panelPaused();stopped.mode(true,true,reason);stopped.mode(true,true,"panel");
  expect(stopped.panelClosed()).toBe(false);
 }
});
test("panel settings and repeated panel focus do not replace an earlier explicit stop", () => {
 const gate=panelPaused();gate.mode(true,true,"escape");gate.mode(true,true,"panel");gate.mode(true,true,"settings");
 expect(gate.panelClosed()).toBe(false);expect(gate.movement(true)).toBe(true);
});
test("guide skip and exhibition return use the same intent, fenced by newer stops and availability", () => {
 for(const action of ["skip-guide","return-exhibition"]){
  const gate=panelPaused(),intent=gate.intent();expect(intent(false),action).toBe(false);expect(intent(true),action).toBe(true);
  const stopped=panelPaused(),oldIntent=stopped.intent();stopped.mode(true,true,"escape");expect(oldIntent(true),action).toBe(false);
  const hidden=panelPaused(),backgroundIntent=hidden.intent();hidden.invalidate();expect(backgroundIntent(true),action).toBe(false);
 }
});


test('restores only intentional input eligibility, never panel-close automatic movement',()=>{
 const restored=createPanelResumeGate(true);restored.mode(true,true,'settings');expect(restored.canResume()).toBe(true);expect(restored.panelClosed()).toBe(false);expect(restored.movement(false)).toBe(false);expect(restored.movement(true)).toBe(true);expect(restored.movement(true)).toBe(false);
 const stationary=createPanelResumeGate(false);stationary.mode(false,true,'settings');expect(stationary.canResume()).toBe(false);
});

test('outside dismissal requires the same panel and a short unmoved completed gesture',()=>{
 const panel={} as HTMLElement,other={} as HTMLElement,g=createPanelDismissalGesture();
 g.begin(1,20,30,panel,0);expect(g.end(1,21,31,panel,true,100)).toBe(true);
 expect(g.end(1,21,31,panel,true,110)).toBe(false);
 for(const [target,outside,at] of [[other,true,100],[panel,false,100],[panel,true,500]] as const){g.begin(1,20,30,panel,0);expect(g.end(1,20,30,target,outside,at)).toBe(false);}
 g.begin(1,20,30,panel,0);g.move(1,40,30);g.move(1,20,30);expect(g.end(1,20,30,panel,true,100)).toBe(false);
 g.begin(1,20,30,panel,0);g.cancel();expect(g.end(1,20,30,panel,true,100)).toBe(false);
});

test('viewer dialog and parent panel Escape preserve return intent while explicit stops and unknown modals fence it',()=>{
 let viewer=false,unknown=false,parent=false;const doc=Object.assign(new EventTarget(),{activeElement:null as unknown,hidden:false});
 const root=Object.assign(new EventTarget(),{contains:(target:unknown)=>target===canvas,querySelectorAll:()=>parent?[{open:true}]:[],querySelector:(selector:string)=>{
  if(selector==='dialog.artwork-detail[open]')return viewer?{}:null;
  if(selector.includes(':not(.artwork-detail)'))return unknown?{}:null;
  return viewer||unknown?{}:null;
 }});
 const canvas={isConnected:true,style:{visibility:''},closest:(selector:string)=>selector==='.publication-shell'?root:null,focus:vi.fn()};doc.activeElement=canvas;
 vi.stubGlobal('document',doc);vi.stubGlobal('window',new EventTarget());
 const resume=vi.fn(),reasons:(string|undefined)[]=[];
 const handler=installPanelResume(canvas as unknown as HTMLCanvasElement,reason=>{reasons.push(reason);handler.mode(true,true,reason);},resume);
 const escape=()=>doc.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));
 handler.mode(true,false);handler.mode(true,true,'panel');const returnIntent=handler.intent();viewer=true;parent=true;escape();
 expect(reasons.at(-1)).toBe('panel');expect(resume).not.toHaveBeenCalled();viewer=false;
 expect(returnIntent()).toBe(false);escape();expect(reasons.at(-1)).toBe('panel');expect(returnIntent()).toBe(false);parent=false;
 canvas.style.visibility='hidden';expect(returnIntent()).toBe(false);canvas.style.visibility='';expect(returnIntent()).toBe(true);expect(returnIntent()).toBe(false);expect(resume).toHaveBeenCalledOnce();
 handler.mode(true,false);handler.mode(true,true,'panel');unknown=true;escape();unknown=false;expect(handler.intent()()).toBe(false);
 handler.mode(true,false);const stoppedIntent=handler.intent();escape();expect(reasons.at(-1)).toBe('escape');expect(stoppedIntent()).toBe(false);expect(handler.movement(true)).toBe(true);
 handler.dispose();
});

test('native selection Escape is left to its control rather than closing the panel',()=>{
 class Control{constructor(private native:boolean){}closest(){return this.native?this:null;}}
 vi.stubGlobal('Element',Control);
 expect(panelEscapeFromControl(new Control(true) as unknown as EventTarget)).toBe(true);
 expect(panelEscapeFromControl(new Control(false) as unknown as EventTarget)).toBe(false);
 expect(panelEscapeFromControl(null)).toBe(false);
});

test('actual touch release is observed before panel dismissal consumes it, while capture loss retains the contact',()=>{
 const doc=Object.assign(new EventTarget(),{activeElement:null as unknown,hidden:false});
 const root=Object.assign(new EventTarget(),{contains:(target:unknown)=>target===canvas,querySelectorAll:()=>[],querySelector:()=>null});
 const canvas={isConnected:true,style:{visibility:''},closest:(selector:string)=>selector==='.publication-shell'?root:null,focus:vi.fn()};doc.activeElement=canvas;
 const win=new EventTarget();vi.stubGlobal('document',doc);vi.stubGlobal('window',win);
 // The root dismissal listener is installed first and owns the closing release.
 doc.addEventListener('pointerup',event=>event.stopImmediatePropagation(),true);
 const resume=vi.fn(),handler=installPanelResume(canvas as unknown as HTMLCanvasElement,vi.fn(),resume);
 handler.mode(true,false);handler.mode(true,true,'panel');
 const pointer=(type:string,pointerId:number)=>{
  // Native capture visits Window before Document, regardless of install order.
  if(type==='pointerup'||type==='pointercancel')win.dispatchEvent(Object.assign(new Event(type),{pointerId}));
  doc.dispatchEvent(Object.assign(new Event(type),{pointerId}));
 };
 pointer('pointerdown',2);pointer('pointerup',2);pointer('lostpointercapture',2);
 expect(resume).not.toHaveBeenCalled();
 pointer('pointerdown',3);
 expect(handler.movement(true)).toBe(true);expect(resume).toHaveBeenCalledOnce();
 pointer('pointerup',3);handler.mode(true,false);handler.mode(true,true,'panel');
 pointer('pointerdown',4);pointer('lostpointercapture',4);pointer('pointerdown',5);
 expect(handler.movement(true)).toBe(false);
 pointer('pointerup',4);pointer('pointercancel',5);pointer('pointerdown',6);
 expect(handler.movement(true)).toBe(true);expect(resume).toHaveBeenCalledTimes(2);
 handler.dispose();
});


test('outside tracking preserves native defaults until a short closing release is confirmed',()=>{
 class DomNode{contains(target:unknown):boolean{return target===this;}closest(){return null;}}
 vi.stubGlobal('Node',DomNode);vi.stubGlobal('Element',DomNode);
 const doc=Object.assign(new EventTarget(),{hidden:false,activeElement:null,querySelectorAll:()=>[],getElementById:()=>null});
 const summary={click:()=>{panel.open=false;},focus:vi.fn()};
 const panel=Object.assign(new DomNode(),{isConnected:true,open:true,getClientRects:()=>[{}],matches:()=>false,querySelectorAll:()=>[],querySelector:()=>summary});
 const root=Object.assign(new DomNode(),{ownerDocument:doc,isConnected:true,querySelectorAll:()=>panel.open?[panel]:[]});
 vi.stubGlobal('window',new EventTarget());
 const dispose=installPanelDismissal(root as unknown as HTMLElement);
 const send=(type:string,x=10,id=1)=>{
  const event=Object.assign(new Event(type,{cancelable:true}),{pointerId:id,isPrimary:id===1,button:0,clientX:x,clientY:10,altKey:false,ctrlKey:false,metaKey:false,detail:1});
  Object.defineProperty(event,'isTrusted',{value:true});doc.dispatchEvent(event);return event;
 };
 expect(send('pointerdown').defaultPrevented).toBe(false);
 expect(send('pointermove',30).defaultPrevented).toBe(false);
 expect(send('pointerup',30).defaultPrevented).toBe(false);expect(panel.open).toBe(true);
 expect(send('click',30).defaultPrevented).toBe(true);
 send('pointerdown');send('pointerdown',20,2);
 expect(send('pointermove',30).defaultPrevented).toBe(false);
 expect(send('pointerup',30).defaultPrevented).toBe(false);send('pointerup',20,2);expect(panel.open).toBe(true);
 send('pointerdown');expect(send('pointercancel').defaultPrevented).toBe(false);expect(panel.open).toBe(true);
 send('pointerdown');expect(send('pointerup').defaultPrevented).toBe(true);expect(panel.open).toBe(false);
 dispose();
});
