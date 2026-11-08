// SPDX-License-Identifier: AGPL-3.0-or-later
declare const __EXHIBITOS_STAGING_DIAGNOSTICS__: boolean | undefined;
export type DiagnosticEvent={atMs:number;assetId:string;artworkRevisionId:string|null;stage:string;errorCode:string|null};
export type DiagnosticSnapshot={
 version:1;capturedAt:string;
 lifecycle:'live'|'stopped'|'context-lost';
 identity:{publicationId:string|null;revisionSha256:string|null;indexSha256:string|null;buildId:string|null;sourceCommit:string|null};
 selected:{placementId:string|null;artworkRevisionId:string|null;reason:'detail'|'attended'|null};
 displayed:{artworkRevisionId:string|null;assetId:string|null;sha256:string|null;tier:'scene'|'detail-approved'|'acquired-original'|null};
 device:{deviceMemoryGiB:number|null;coarsePointer:boolean;finePointer:boolean;pixelRatio:number;viewportWidth:number;viewportHeight:number;budget:{maxCacheBytes:number;maxTransitionBytes:number;maxTextureSize:number;maxTriangles:number;effectiveResidentBytes:number;effectiveTransitionBytes:number;selectedDetailResidentBytes:number|null;selectedDetailTransitionBytes:number|null;originalDetailTransitionBytes:number|null;originalDetailSceneBytes:number|null}|null};
 navigation:{roomId:string|null;position:[number,number,number];quaternion:[number,number,number,number];verticalFov:number}|null;
 memory:{residentEstimateBytes:number|null;transitionEstimateBytes:number|null;peakTransitionEstimateBytes:number|null;textureEstimateBytes:number|null;peakTextureEstimateBytes:number|null;meshEstimateBytes:number|null;peakMeshEstimateBytes:number|null;renderTargetEstimateBytes:number|null;peakRenderTargetEstimateBytes:null;gpuPhysicalBytes:null};
 assets:Array<{assetId:string;artworkRevisionId:string|null;sha256:string|null;bytes:number|null;mime:string|null;path:string|null;active:boolean}>;
 events:DiagnosticEvent[];
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
 return {record(event:DiagnosticEvent){
  if(!diagnosticsEnabled()||!Number.isFinite(event.atMs)||event.atMs<0||!/^[a-f0-9-]{36}$/i.test(event.assetId)||event.artworkRevisionId!==null&&!/^[a-f0-9-]{36}$/i.test(event.artworkRevisionId)||!/^[a-z][a-z0-9-]{0,63}$/.test(event.stage)||event.errorCode!==null&&!/^[A-Z][A-Z0-9_]{0,79}$/.test(event.errorCode))return;
  events.push({...event});if(events.length>64)events.shift();
 },snapshot:()=>events.map(event=>({...event}))};
}
