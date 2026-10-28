// SPDX-License-Identifier: AGPL-3.0-or-later
import {setViewingPlan,type ViewingPlan} from '@exhibitos/studio-contract';
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {validateDraft} from './drafts/validator';
export const NATIVE_VIEWING_PLAN_CAPABILITY='viewing-plan-v1' as const;
export interface ViewingPlanRequest extends CatalogBinding {type:'set-viewing-plan';plan:ViewingPlan|null}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function checkedViewingPlanRequest(value:unknown,frame:NativeViewportFrame|undefined):ViewingPlanRequest {
 if(!frame||frame.disabled||!object(value))throw Error('VIEWING_PLAN_REQUEST_INVALID');
 if(Object.keys(value).sort().join(',')!=='epoch,plan,principalId,requestId,sequence,tenantId,type,version'||value.version!==1||value.type!=='set-viewing-plan'||!uuid(value.requestId)||value.epoch!==frame.epoch||value.sequence!==frame.sequence||value.tenantId!==frame.tenantId||value.principalId!==frame.principalId)throw Error('VIEWING_PLAN_REQUEST_STALE');
 try{setViewingPlan(frame.draft.candidate,value.plan as ViewingPlan|null);}catch{throw Error('VIEWING_PLAN_REQUEST_INVALID');}
 return structuredClone(value) as unknown as ViewingPlanRequest;
}
export function nativeViewingPlanCandidate(frame:NativeViewportFrame,input:unknown){
 const request=checkedViewingPlanRequest(input,frame);
 if(!validateDraft(frame.draft).valid)throw Error('VIEWING_PLAN_SOURCE_INVALID');
 const candidate=setViewingPlan(frame.draft.candidate,request.plan);
 if(!validateDraft({...frame.draft,candidate}).valid)throw Error('VIEWING_PLAN_CANDIDATE_INVALID');
 return candidate;
}
