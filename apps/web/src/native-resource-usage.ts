// SPDX-License-Identifier: AGPL-3.0-or-later
import {evaluateViewerBudgetUsage,type ResolvedViewerBudgetPolicy} from '@exhibitos/studio-contract';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {catalogBinding,type CatalogBinding} from './native-catalog-protocol';
import {snapshotCandidateHash} from './native-scene-snapshot';
import type {SceneResourceUsage} from './viewer/scene-resource-usage';
export const NATIVE_RESOURCE_USAGE_CAPABILITY='viewer-resource-usage-v1';
export type NativeResourceUsageSource={document:NativeViewportFrame['draft']['candidate'];policy?:ResolvedViewerBudgetPolicy;read:()=>SceneResourceUsage};
export function checkedResourceUsageRequest(value:unknown,frame:NativeViewportFrame|undefined):CatalogBinding{
 if(!frame||!value||typeof value!=='object'||Array.isArray(value))throw Error('RESOURCE_USAGE_UNAVAILABLE');
 const request=value as CatalogBinding;
 if(Object.keys(request).sort().join(',')!=='epoch,principalId,requestId,sequence,tenantId,version'||request.version!==1||request.epoch!==frame.epoch||request.sequence!==frame.sequence||request.tenantId!==frame.tenantId||request.principalId!==frame.principalId||typeof request.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.requestId))throw Error('RESOURCE_USAGE_STALE');
 return structuredClone(request);
}
/** Read-only live observation. The supported API supplies whole-exhibition
 * analysis even without this window; this bridge never claims all-view safety. */
export async function readNativeResourceUsage(request:CatalogBinding,frame:NativeViewportFrame,options:{current:()=>boolean;source:()=>NativeResourceUsageSource|null;authenticate:()=>Promise<unknown>}){
 const valid=()=>{if(!options.current())throw Error('RESOURCE_USAGE_STALE');};
 valid();await options.authenticate();valid();
 const candidateSha256=await snapshotCandidateHash(frame);valid();
 const source=options.source(),available=source?.document===frame.draft.candidate;
 const observations=available?source.read():null,policy=available&&source.policy?structuredClone(source.policy):null;
 valid();if(options.source()!==source)throw Error('RESOURCE_USAGE_STALE');
 const evaluation=observations&&policy?evaluateViewerBudgetUsage(policy,{...observations,scope:'analyzedSection',contributors:observations.sections.map(row=>({id:row.roomId,label:row.roomId,roomId:row.roomId,usage:{colorDraws:row.colorDraws,displayTriangles:row.displayTriangles}})),assumptions:[...observations.assumptions]}):null;
 return {...catalogBinding(request),candidateSha256,policy,observations,evaluation};
}
