// SPDX-License-Identifier: AGPL-3.0-or-later
import type {AssetPeakBudget} from '../viewer/loading';
import type {OwnerPreviewBudget} from './owner-preview-budget';

export const WORKSPACE_FAILURE_STAGES=['byte-reserve','display-check','descriptor-match','model-fetch','integrity','preflight','decode','loaded-validation','scene-reserve','placement','unknown'] as const;
export const WORKSPACE_FAILURE_CODES=['WORKSPACE_MODEL_AUTHORITY','WORKSPACE_MODEL_FETCH','WORKSPACE_MODEL_INTEGRITY','WORKSPACE_MODEL_INVALID','WORKSPACE_MODEL_BUDGET','WORKSPACE_MODEL_UNSUPPORTED','WORKSPACE_SCENE_BUDGET','WORKSPACE_PLACEMENT_INVALID','DECODE_BUDGET_EXCEEDED','ASSET_BUDGET_EXCEEDED','ASSET_TRANSITION_PEAK','WORKSPACE_FURNISHING_UNSUPPORTED','WORKSPACE_MODEL_INACTIVE','ABORTED','NETWORK_ERROR','OTHER_FAILURE'] as const;
type Stage=typeof WORKSPACE_FAILURE_STAGES[number];
export interface WorkspaceFailureDetails {
 stage:Stage;code:typeof WORKSPACE_FAILURE_CODES[number];httpKind:'display-check'|'model'|null;httpStatus:number|null;
 remainingDraws:number;remainingTriangles:number;requestedDraws:number|null;requestedTriangles:number|null;
 byteLimit:number;bytesUsed:number;bytesReserved:number;requestedBytes:number|null;
}
export interface WorkspaceFailureObserver {
 stage(stage:Stage,requestedBytes?:number):void;
 http(kind:'display-check'|'model',status:number|null):void;
 scene(draws:number,triangles:number):void;
 failure(error:unknown,currentBytes?:number):void;
}
export interface WorkspaceFailureRow extends WorkspaceFailureDetails {placementId:string;furnishingId:string;furnishingVersion:number;modelSha256:string}
export interface WorkspaceFailureReadout {version:1;settled:boolean;loaded:number;failed:number;truncated:boolean;failures:WorkspaceFailureRow[]}
/** Fixed diagnostic values only. Never copy arbitrary exception text, URLs or bodies. */
function failureCode(error:unknown,stage:Stage):WorkspaceFailureDetails['code']{
 if(error instanceof Error){
  const known=WORKSPACE_FAILURE_CODES.find(code=>code===error.message);if(known)return known;
  if(error.name==='AbortError'||error.name==='TimeoutError')return 'ABORTED';
  if(error instanceof TypeError&&(stage==='display-check'||stage==='model-fetch'))return 'NETWORK_ERROR';
 }
 return 'OTHER_FAILURE';
}
/** The failing hold is sampled before cleanup; a replacement request must be
 * compared with used - current hold + requested, not used + requested. */
export function workspaceFailureObserver(scope:OwnerPreviewBudget,ledger:AssetPeakBudget,byteLimit:number,record:(details:WorkspaceFailureDetails)=>void):WorkspaceFailureObserver {
 let stage:Stage='placement',httpKind:WorkspaceFailureDetails['httpKind']=null,httpStatus:number|null=null,requestedBytes:number|null=null,requestedDraws:number|null=null,requestedTriangles:number|null=null;
 return {
  stage(value,bytes){stage=value;requestedBytes=bytes??null;},
  http(kind,status){httpKind=kind;httpStatus=status;},
  scene(draws,triangles){stage='scene-reserve';requestedBytes=null;requestedDraws=draws;requestedTriangles=triangles;},
  failure(error,currentBytes=0){
   // Diagnostics cannot change the loader's original exception or cleanup.
   try{record({stage,code:failureCode(error,stage),httpKind,httpStatus,...scope.remaining(),requestedDraws,requestedTriangles,byteLimit,bytesUsed:ledger.total(),bytesReserved:currentBytes,requestedBytes});}catch{/* Keep the original failure authoritative. */}
  },
 };
}
