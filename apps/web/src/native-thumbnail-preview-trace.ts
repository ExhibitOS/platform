// SPDX-License-Identifier: AGPL-3.0-or-later
export const ARTWORK_THUMBNAIL_PREVIEW_TRACE_CAPABILITY = 'artwork-thumbnail-preview-trace-v1';
export const ARTWORK_THUMBNAIL_PREVIEW_TRACE_HEADER = 'x-exhibitos-thumbnail-trace';
const thumbnailTraceId=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type PreviewTerminal =
 | {kind:'headers';elapsedMs:number;status:number}
 | {kind:'cancelled';elapsedMs:number;reason:'timeout'|'cancelled'}
 | {kind:'failed';elapsedMs:number};

export interface ThumbnailPreviewTrace {
 version:1;
 requestId:string;
 anchorUnixMs:number;
 dispatchElapsedMs:number;
 remainingBudgetEstimateMs:number;
 terminal:PreviewTerminal;
}

type PreviewOptions = RequestInit & {signal:AbortSignal};
export interface ThumbnailPreviewObservation {
 fetch(path:string,options:PreviewOptions):Promise<Response>;
 settleAbort():void;
 result():ThumbnailPreviewTrace|null;
}

export function isThumbnailPreviewTracePage(location:Pick<Location,'protocol'|'hostname'|'port'|'pathname'>) {
 return location.protocol==='http:'&&location.hostname==='127.0.0.1'&&Number(location.port)>=1024&&
  location.pathname==='/native-viewport.html';
}

/** One ordinary preview fetch, with a private, first-terminal observation. */
export function observeThumbnailPreview(
 requestId:unknown,deadline:AbortSignal,budgetMs:number,clock:{monotonicMs:number;unixMs:number},
):ThumbnailPreviewObservation|undefined {
 if(typeof requestId!=='string'||!thumbnailTraceId.test(requestId))return;
 const id=requestId.toLowerCase();
 let dispatched=false;
 let trace:ThumbnailPreviewTrace|null=null;
 let settlePendingAbort:(()=>void)|undefined;
 const elapsed=()=>Math.round(Math.max(0,Math.min(60_000,performance.now()-clock.monotonicMs)));
 return {
  async fetch(path,options){
   const {signal}=options;
   if(dispatched||signal.aborted)return fetch(path,options);
   dispatched=true;
   const dispatchElapsedMs=elapsed();
   const prefix={
    version:1 as const,requestId:id,anchorUnixMs:clock.unixMs,dispatchElapsedMs,
    remainingBudgetEstimateMs:Math.max(0,budgetMs-dispatchElapsedMs),
   };
   const record=(terminal:PreviewTerminal)=>{trace??={...prefix,terminal};};
   const cancelled=()=>{
    if(!signal.aborted)return;
    record({
     kind:'cancelled',elapsedMs:elapsed(),
     reason:deadline.aborted&&signal.reason===deadline.reason?'timeout':'cancelled',
    });
   };
   // Preserve dispatch data before issuing the GET. The outer deadline can
   // return its failure while this fetch and its listener are still pending.
   settlePendingAbort=cancelled;
   signal.addEventListener('abort',cancelled,{once:true});
   try{
    const response=await fetch(path,{...options,headers:{[ARTWORK_THUMBNAIL_PREVIEW_TRACE_HEADER]:id}});
    const status=response.status;
    if(Number.isInteger(status)&&status>=100&&status<=599)record({kind:'headers',elapsedMs:elapsed(),status});
    else record({kind:'failed',elapsedMs:elapsed()});
    return response;
   }catch(error){
    record({kind:'failed',elapsedMs:elapsed()});
    throw error;
   }finally{
    settlePendingAbort=undefined;
    signal.removeEventListener('abort',cancelled);
   }
  },
  settleAbort:()=>settlePendingAbort?.(),
  result:()=>trace,
 };
}
