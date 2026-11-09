// SPDX-License-Identifier: AGPL-3.0-or-later
declare const __EXHIBITOS_STAGING_DIAGNOSTICS__: boolean | undefined;
export type DiagnosticEvent={atMs:number;assetId:string;artworkRevisionId:string|null;stage:string;errorCode:string|null};
export type DiagnosticSnapshot={
 version:1;capturedAt:string;
 lifecycle:'live'|'stopped'|'context-lost';
 identity:{publicationId:string|null;revisionSha256:string|null;indexSha256:string|null;buildId:string|null;sourceCommit:string|null};
 selected:{placementId:string|null;artworkRevisionId:string|null;reason:'detail'|'attended'|null};
 displayed:{artworkRevisionId:string|null;assetId:string|null;sha256:string|null;tier:'scene'|'detail-lightweight'|'detail-approved'|'acquired-original'|null};
 device:{deviceMemoryGiB:number|null;coarsePointer:boolean;finePointer:boolean;pixelRatio:number;viewportWidth:number;viewportHeight:number;budget:{maxCacheBytes:number;maxTransitionBytes:number;maxTextureSize:number;maxTriangles:number;effectiveResidentBytes:number;effectiveTransitionBytes:number;selectedDetailResidentBytes:number|null;selectedDetailTransitionBytes:number|null;originalDetailTransitionBytes:number|null;originalDetailSceneBytes:number|null}|null};
 navigation:{roomId:string|null;position:[number,number,number];quaternion:[number,number,number,number];verticalFov:number}|null;
 memory:{residentEstimateBytes:number|null;transitionEstimateBytes:number|null;peakTransitionEstimateBytes:number|null;textureEstimateBytes:number|null;peakTextureEstimateBytes:number|null;meshEstimateBytes:number|null;peakMeshEstimateBytes:number|null;renderTargetEstimateBytes:number|null;peakRenderTargetEstimateBytes:null;gpuPhysicalBytes:null};
 assets:Array<{assetId:string;artworkRevisionId:string|null;sha256:string|null;bytes:number|null;mime:string|null;path:string|null;active:boolean}>;
 events:DiagnosticEvent[];
 selectedDetailEvents?:DiagnosticEvent[];
};
export const diagnosticsEnabled=()=>typeof __EXHIBITOS_STAGING_DIAGNOSTICS__!=='undefined'&&__EXHIBITOS_STAGING_DIAGNOSTICS__===true;
let current:(()=>DiagnosticSnapshot)|null=null;
/** Only the active staging Viewer may supply a snapshot; teardown is identity fenced. */
export function registerDiagnosticSource(source:()=>DiagnosticSnapshot):()=>void {
 if(!diagnosticsEnabled())return ()=>{};
 current=source;return ()=>{if(current===source)current=null;};
}
export function readDiagnosticSnapshot(expected:{publicationId:string;revisionSha256:string;detail?:{placementId:string;artworkRevisionId:string}}):DiagnosticSnapshot|null {
 if(!diagnosticsEnabled()||!current)return null;
 const snapshot=current();if(snapshot.identity.publicationId!==expected.publicationId||snapshot.identity.revisionSha256!==expected.revisionSha256)return null;
 return snapshot;
}
export function createDiagnosticEvents(){
 const events:DiagnosticEvent[]=[];
 let selected:{revisionId:string;assets:Set<string>;decision?:DiagnosticEvent;events:DiagnosticEvent[]}|undefined;
 const valid=(event:DiagnosticEvent)=>diagnosticsEnabled()&&Number.isFinite(event.atMs)&&event.atMs>=0&&/^[a-f0-9-]{36}$/i.test(event.assetId)&&(event.artworkRevisionId===null||/^[a-f0-9-]{36}$/i.test(event.artworkRevisionId))&&/^[a-z][a-z0-9-]{0,63}$/.test(event.stage)&&(event.errorCode===null||/^[A-Z][A-Z0-9_]{0,79}$/.test(event.errorCode));
 const matches=(event:DiagnosticEvent)=>!!selected&&selected.revisionId===event.artworkRevisionId?.toLowerCase()&&selected.assets.has(event.assetId.toLowerCase());
 return {
  beginSelected(revisionId:string,assetIds:readonly string[]){
   if(diagnosticsEnabled())selected={revisionId:revisionId.toLowerCase(),assets:new Set(assetIds.map(id=>id.toLowerCase())),events:[]};
  },
  clearSelected(){selected=undefined;},
  decision(event:DiagnosticEvent){
   if(selected&&!selected.decision&&matches(event)&&valid(event))selected.decision={...event};
  },
  record(event:DiagnosticEvent){
   if(!valid(event))return;
   events.push({...event});if(events.length>64)events.shift();
   if(selected&&matches(event)){
    selected.events.push({...event});if(selected.events.length>15)selected.events.shift();
   }
  },
  snapshot:()=>events.map(event=>({...event})),
  selectedSnapshot:()=>selected?[...(selected.decision?[selected.decision]:[]),...selected.events].map(event=>({...event})):undefined,
 };
}
