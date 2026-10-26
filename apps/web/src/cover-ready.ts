// SPDX-License-Identifier: AGPL-3.0-or-later
/** Only real font completion and consecutive laid-out frames qualify a cover.
 * Reads untransformed layout: the two paper faces already reserve their final slots.
 * Caller owns cancellation, timeout and the visible flat fallback. */
export async function waitForCoverLayout(element:HTMLElement,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted();
 await new Promise<void>((resolve,reject)=>{
  const stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});
  void element.ownerDocument.fonts.ready.then(()=>{signal.removeEventListener('abort',stop);resolve();},error=>{signal.removeEventListener('abort',stop);reject(error);});
  if(signal.aborted)stop();
 });
 signal.throwIfAborted();
 return new Promise<void>((resolve,reject)=>{
  let frame=0,previous='',stable=0;
  const stop=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',stop);reject(signal.reason);};
  const measure=()=>{
   if(signal.aborted){stop();return;}
   if(!element.isConnected){signal.removeEventListener('abort',stop);reject(Error('COVER_UNMOUNTED'));return;}
   const nodes=[element,...element.querySelectorAll<HTMLElement>('.entrance-cover-prose,.entrance-cover-image,.entrance-paper-ticket-slot')];
   const size=nodes.map(n=>[n.offsetWidth,n.offsetHeight,n.scrollWidth,n.scrollHeight].join(',')).join(';');
   stable=size===previous&&element.offsetWidth>0&&element.offsetHeight>0?stable+1:0;previous=size;
   if(stable>=1){signal.removeEventListener('abort',stop);resolve();}else frame=requestAnimationFrame(measure);
  };
  signal.addEventListener('abort',stop,{once:true});frame=requestAnimationFrame(measure);
 });
}
