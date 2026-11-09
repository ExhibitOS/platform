// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WalkingPauseReason } from "./navigation-input";

// Temporary panel obstruction clears on last close. Explicit stops retain their own
// cause and need a fresh deliberate input; no stored keys, gesture or velocity replay.
export function createPanelResumeGate(restoredWalking = false) {
  let active = false, eligible = restoredWalking, panelOwned = false, benchReturn = false, stopGeneration = 0;
  let gesture: { id: number; x: number; y: number; released: boolean } | undefined;
  const cancel = () => { gesture = undefined; };
  return {
    mode(walking: boolean, paused: boolean, reason?: WalkingPauseReason) {
      const explicitPause = reason === "escape" || reason === "pointerlock" || reason === "user";
      const retained = active || eligible;
      if (reason === "bench-return") {
        stopGeneration++; eligible = walking; panelOwned = false; benchReturn = walking;
      } else if (explicitPause) {
        benchReturn = false;
        stopGeneration++; eligible = walking && retained; panelOwned = false;
      } else if (reason === "panel") {
        if (active) { eligible = walking; panelOwned = true; benchReturn = false; }
      } else if (reason === "window" || reason === "hidden" || reason === "blur") {
        // Backgrounding stops motion, but a later fresh input may resume an
        // already resumable session. It must never create eligibility from rest.
        eligible = walking && retained; panelOwned = false;
        stopGeneration++;
      } else if (reason !== "settings" || !eligible) {
        eligible = false; panelOwned = false; benchReturn = false;
        if (paused) stopGeneration++;
      }
      if (!walking) { eligible = false; panelOwned = false; benchReturn = false; }
      active = walking && !paused;
      cancel();
    },
    invalidate() { active = false; eligible = false; panelOwned = false; benchReturn = false; stopGeneration++; cancel(); },
    background() { eligible = active || eligible; active = false; panelOwned = false; stopGeneration++; cancel(); },
    cancel,
    canResume: () => eligible,
    isActive: () => active,
    requiresPanel: () => panelOwned,
    wasWalkingBeforeSeat: () => active || panelOwned || (benchReturn && eligible),
    isBenchReturn: () => benchReturn,
    panelClosed() {
      if (!panelOwned || !eligible) return false;
      panelOwned = false; eligible = false; cancel(); return true;
    },
    intent() {
      const generation = stopGeneration;
      return (allowed: boolean) => generation === stopGeneration && this.movement(allowed);
    },
    movement(allowed: boolean) {
      const result = eligible && allowed;
      if (result) { eligible = false; panelOwned = false; cancel(); }
      return result;
    },
    begin(id: number, x: number, y: number, allowed: boolean) {
      gesture = eligible && allowed ? { id, x, y, released: false } : undefined;
    },
    move(id: number, x: number, y: number) {
      if (gesture?.id === id && Math.hypot(x - gesture.x, y - gesture.y) > 5) cancel();
    },
    end(id: number, x: number, y: number, onCanvas: boolean) {
      this.move(id, x, y);
      if (gesture?.id === id) { if (onCanvas) gesture.released = true; else cancel(); }
    },
    consume(x: number, y: number, allowed: boolean) {
      const resume = eligible && allowed && !!gesture?.released && Math.hypot(x - gesture.x, y - gesture.y) <= 5;
      cancel();
      if (resume) eligible = false;
      return resume;
    },
  };
}

export function installPanelResume(canvas: HTMLCanvasElement, pause: (reason?: WalkingPauseReason) => void, resume: () => void, availabilityChanged: (available: boolean) => void = () => {}, allowed: () => boolean = () => true, restoredWalking = false) {
  const root = canvas.closest(".publication-shell");
  const gate = createPanelResumeGate(restoredWalking), pointers = new Set<number>();
  let gestureBlocked = false, resumingDrag = false;
  let panelFocus = false, focusTimer: ReturnType<typeof setTimeout> | undefined;
  const panels = () => [...(root?.querySelectorAll<HTMLDetailsElement>("details[data-visitor-panel]") ?? [])];
  const owns = (target: EventTarget | null) => target instanceof Element &&
    (panels().some(panel => panel.contains(target)) || !!target.closest(".viewer-brief, .artwork-detail"));
  const ownsBenchSit = (target: EventTarget | null) => target instanceof Element &&
    !!target.closest('button[data-bench-action][data-bench-seated="false"]')?.closest('.geometry-preview')?.contains(canvas);
  const open = () => panels().some(panel => panel.open);
  const down = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    if (pointers.size > 1) gestureBlocked = true;
    gate.cancel();
    if (!event.isTrusted || !event.isPrimary || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || pointers.size !== 1) return;
    if (owns(event.target) || ownsBenchSit(event.target)) {
      // Pause before the pointer's default focus change, including browsers
      // whose canvas blur has a null relatedTarget. The opening click is never
      // a canvas gesture and therefore cannot resume the session it just paused.
      panelFocus = true;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { panelFocus = false; }, 0);
      pause();
    } else if (event.target === canvas) {
      gate.begin(event.pointerId, event.clientX, event.clientY, canResume());
    }
  };
  const move = (event: PointerEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) { gate.cancel(); return; }
    for (const sample of event.getCoalescedEvents?.() ?? [event]) gate.move(sample.pointerId, sample.clientX, sample.clientY);
    gate.move(event.pointerId, event.clientX, event.clientY);
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (!pointers.size) gestureBlocked = false;
    gate.end(event.pointerId, event.clientX, event.clientY, event.target === canvas);
  };
  const cancel = () => gate.cancel();
  const invalid = () => { gate.invalidate(); pointers.clear(); gestureBlocked = false; panelFocus = false; availabilityChanged(false); };
  const background = () => { gate.background(); pointers.clear(); gestureBlocked = false; panelFocus = false; availabilityChanged(false); };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // The input listener pauses the current session. A repeated Escape must not
    // erase that explicit resume choice; closing a mandatory dialog still does.
    if ((root?.querySelector('dialog.artwork-detail[open]') || open()) &&
        !root?.querySelector('dialog[open]:not(.artwork-detail), [aria-modal="true"]:not(.artwork-detail)')) {
      // A viewer dialog or panel's own handler will close its obstruction.
      // Keep only the prior fresh-input eligibility; pause still clears every
      // held key, pointer, joystick and pending capture before that close.
      gate.cancel(); pause("panel");
    } else if (root?.querySelector('dialog[open], [aria-modal="true"]')) invalid();
    else { gate.cancel(); if (root?.contains(document.activeElement)) pause("escape"); }
  };
  const hidden = () => { if (document.hidden) background(); else availabilityChanged(canResume()); };
  const cancelled = (event: PointerEvent) => { pointers.delete(event.pointerId); if (!pointers.size) gestureBlocked = false; cancel(); };
  const toggle = () => {
    if (open()) pause();
    else if (safe() && gate.panelClosed()) resume();
    else if (canResume() && owns(document.activeElement)) canvas.focus({ preventScroll: true });
    availabilityChanged(canResume());
  };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointermove", move, true);
  // Observe actual contact termination before document-level panel dismissal
  // consumes it. Capture loss alone can occur while the contact is still down.
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancelled, true);
  document.addEventListener("keydown", key, true);
  document.addEventListener("visibilitychange", hidden);
  document.addEventListener("wheel", cancel, true);
  document.addEventListener("scroll", cancel, true);
  document.addEventListener("contextmenu", cancel, true);
  root?.addEventListener("toggle", toggle, true);
  window.addEventListener("blur", background);
  const focus = () => availabilityChanged(canResume());
  window.addEventListener("focus", focus);
  const safe = () => allowed() && !document.hidden && canvas.isConnected && canvas.style.visibility !== "hidden" &&
    !canvas.closest('[hidden], [inert]') &&
    !root?.querySelector('dialog[open], [aria-modal="true"], [inert] canvas');
  const canResume = () => gate.canResume() && !open() && safe();
  return {
    mode(walking: boolean, paused: boolean, reason?: WalkingPauseReason) {
      gate.mode(walking, paused, reason);
      if (walking && !paused && open() && !resumingDrag) queueMicrotask(() => { if (open() && gate.isActive()) pause(); });
      availabilityChanged(canResume());
    },
    canResume,
    wasWalkingBeforeSeat: gate.wasWalkingBeforeSeat,
    isBenchReturn: gate.isBenchReturn,
    movement(allowed: boolean) {
      if (!gate.movement(allowed && !gestureBlocked && pointers.size <= 1 && canResume())) return false;
      resume();
      return true;
    },
    drag(allowed: boolean) {
      if (!gate.movement(allowed && !gestureBlocked && pointers.size <= 1 && safe() && (!gate.isBenchReturn() || !open()))) return false;
      resumingDrag = true;
      try { resume(); } finally { resumingDrag = false; }
      availabilityChanged(canResume());
      return true;
    },
    intent() {
      const consume = gate.intent();
      return () => {
        if (!consume(!open() && safe())) return false;
        resume(); availabilityChanged(canResume()); return true;
      };
    },
    resumeTemporary() {
      if(open()||!safe()||!gate.panelClosed())return false;
      resume();availabilityChanged(canResume());return true;
    },
    isPanelFocus: (target: EventTarget | null) => panelFocus || owns(target),
    blank(event: MouseEvent, allowed: boolean) {
      if (!gate.consume(event.clientX, event.clientY, allowed && event.isTrusted && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && canResume())) return;
      // Existing start clears held input and velocity; no pointer-lock request.
      resume();
    },
    dispose() {
      invalid(); clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelled, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("wheel", cancel, true);
      document.removeEventListener("scroll", cancel, true);
      document.removeEventListener("contextmenu", cancel, true);
      root?.removeEventListener("toggle", toggle, true);
      window.removeEventListener("blur", background);
      window.removeEventListener("focus", focus);
    },
  };
}

/** The outside gesture is separate from the next deliberate navigation input. */
export function createPanelDismissalGesture() {
  let gesture:{id:number;x:number;y:number;panel:HTMLElement;at:number;valid:boolean}|undefined;
  const move=(id:number,x:number,y:number)=>{if(gesture?.id===id&&Math.hypot(x-gesture.x,y-gesture.y)>6)gesture.valid=false;};
  return {
    begin(id:number,x:number,y:number,panel:HTMLElement,at:number){gesture={id,x,y,panel,at,valid:true};},
    move,
    cancel(){gesture=undefined;},
    end(id:number,x:number,y:number,panel:HTMLElement|null,outside:boolean,at:number){
      if(gesture?.id!==id)return false;
      move(id,x,y);const previous=gesture;gesture=undefined;
      return previous.valid&&previous.panel===panel&&outside&&at>=previous.at&&at-previous.at<500;
    },
  };
}

/** Escape belongs to a native selection popup before its surrounding panel. */
export function panelEscapeFromControl(target:EventTarget|null) {
  return typeof Element!=='undefined'&&target instanceof Element&&!!target.closest('select, option, [role="combobox"], [role="listbox"]');
}

/** One owner on the publication root, including when walking is unavailable.
 * Native summary/cancel handlers retain React state, voice and focus cleanup. */
export function installPanelDismissal(root:HTMLElement) {
  const doc=root.ownerDocument,gesture=createPanelDismissalGesture(),pointers=new Set<number>();
  let outsidePointer:number|undefined,suppressed:{x:number;y:number;until:number}|undefined;
  const consume=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
  // Keep the underlying canvas from starting on this sequence, without
  // cancelling native scrolling, pinch or long-press defaults while tracking.
  const shield=(event:Event)=>event.stopPropagation();
  const visible=(panel:HTMLElement)=>panel.isConnected&&!panel.closest('[hidden], [inert], details:not([open])')&&panel.getClientRects().length>0;
  const active=():HTMLElement|null=>{
    if(!root.isConnected||doc.hidden)return null;
    const modals=[...doc.querySelectorAll<HTMLElement>('dialog[open], [aria-modal="true"]')].filter(visible);
    if(modals.length){const top=modals.at(-1)!;return root.contains(top)&&top.matches('dialog.artwork-detail[open]')?top:null;}
    const panels=[...root.querySelectorAll<HTMLElement>('details[data-visitor-panel][open]')].filter(visible);
    return panels.filter(panel=>!panels.some(child=>child!==panel&&panel.contains(child))).at(-1)??null;
  };
  const inside=(panel:HTMLElement,event:PointerEvent)=>{
    const target=event.target;
    if(!(target instanceof Node))return false;
    if(panel.matches('dialog')&&target===panel){const b=panel.getBoundingClientRect();return event.clientX>=b.left&&event.clientX<=b.right&&event.clientY>=b.top&&event.clientY<=b.bottom;}
    if(panel.contains(target))return true;
    // Portals already tied to an in-panel native/ARIA control remain internal.
    return [...panel.querySelectorAll('[aria-controls], [aria-owns]')].some(control=>
      `${control.getAttribute('aria-controls')??''} ${control.getAttribute('aria-owns')??''}`.split(/\s+/).filter(Boolean).some(id=>doc.getElementById(id)?.contains(target)));
  };
  const otherTrigger=(panel:HTMLElement,event:PointerEvent)=>{
    const summary=event.target instanceof Element?event.target.closest('summary'):null;
    const owner=summary?.parentElement;
    return !!owner&&root.contains(owner)&&owner!==panel&&!owner.contains(panel)&&owner.matches('details[data-visitor-panel]')&&
      !summary?.closest('[hidden], [inert]')&&!!summary?.getClientRects().length;
  };
  const dismiss=(panel:HTMLElement)=>{
    if(panel.matches('dialog.artwork-detail')){panel.dispatchEvent(new Event('cancel',{cancelable:true}));return;}
    const summary=panel.querySelector<HTMLElement>(':scope>summary');
    summary?.click();
    if(!(panel as HTMLDetailsElement).open&&panel.contains(doc.activeElement))summary?.focus({preventScroll:true});
  };
  const down=(event:PointerEvent)=>{
    suppressed=undefined;pointers.add(event.pointerId);
    if(pointers.size>1){gesture.cancel();if(outsidePointer!==undefined)shield(event);return;}
    outsidePointer=undefined;gesture.cancel();
    if(!event.isTrusted||event.isPrimary===false||event.button!==0||event.altKey||event.ctrlKey||event.metaKey)return;
    const panel=active();if(!panel||inside(panel,event)||otherTrigger(panel,event))return;
    // This trusted outside intent also retires the choice's inactivity timer
    // through its existing non-initial-focus handler, even if the gesture drags.
    if(panel.matches('.viewer-input-help[data-help-phase="choice"]'))panel.querySelector<HTMLElement>(':scope>summary')?.focus({preventScroll:true});
    outsidePointer=event.pointerId;gesture.begin(event.pointerId,event.clientX,event.clientY,panel,performance.now());shield(event);
  };
  const move=(event:PointerEvent)=>{
    if(outsidePointer===undefined)return;
    if(event.altKey||event.ctrlKey||event.metaKey)gesture.cancel();
    for(const sample of event.getCoalescedEvents?.()??[event])gesture.move(sample.pointerId,sample.clientX,sample.clientY);
    gesture.move(event.pointerId,event.clientX,event.clientY);shield(event);
  };
  const up=(event:PointerEvent)=>{
    pointers.delete(event.pointerId);if(outsidePointer===undefined)return;
    const panel=active();
    const close=gesture.end(event.pointerId,event.clientX,event.clientY,panel,!!panel&&!inside(panel,event)&&!event.altKey&&!event.ctrlKey&&!event.metaKey,performance.now());
    if(close)consume(event);else shield(event);
    if(event.pointerId===outsidePointer){outsidePointer=undefined;suppressed={x:event.clientX,y:event.clientY,until:performance.now()+500};}
    if(close&&panel)dismiss(panel);
  };
  const cancel=(event:PointerEvent)=>{pointers.delete(event.pointerId);gesture.cancel();if(event.pointerId===outsidePointer){outsidePointer=undefined;suppressed={x:event.clientX,y:event.clientY,until:performance.now()+500};shield(event);}};
  const click=(event:MouseEvent)=>{
    if(!event.isTrusted||event.detail===0||!suppressed)return;
    const previous=suppressed;suppressed=undefined;
    if(performance.now()<=previous.until&&Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<=6)consume(event);
  };
  const interrupt=()=>gesture.cancel();
  const reset=()=>{gesture.cancel();pointers.clear();outsidePointer=undefined;suppressed=undefined;};
  doc.addEventListener('pointerdown',down,true);doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',cancel,true);doc.addEventListener('click',click,true);
  doc.addEventListener('wheel',interrupt,true);doc.addEventListener('scroll',interrupt,true);doc.addEventListener('contextmenu',interrupt,true);doc.addEventListener('visibilitychange',reset);window.addEventListener('blur',reset);
  return ()=>{
    reset();doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',cancel,true);doc.removeEventListener('click',click,true);
    doc.removeEventListener('wheel',interrupt,true);doc.removeEventListener('scroll',interrupt,true);doc.removeEventListener('contextmenu',interrupt,true);doc.removeEventListener('visibilitychange',reset);window.removeEventListener('blur',reset);
  };
}
