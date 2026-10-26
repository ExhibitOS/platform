// SPDX-License-Identifier: AGPL-3.0-or-later
import {setLightDetails} from '@exhibitos/studio-contract';
import type {ExhibitionLight,LightDetails} from '@exhibitos/studio-contract';
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {validateDraft} from './drafts/validator';
export const NATIVE_LIGHT_DETAILS_CAPABILITY='light-fixture-aim-v1' as const;
export interface LightDetailsRequest extends CatalogBinding {type:'set-light-details';lightId:string;light:Omit<ExhibitionLight,'id'>;settings:Omit<LightDetails,'lightId'>}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function checkedLightDetailsRequest(value:unknown,frame:NativeViewportFrame|undefined):LightDetailsRequest {
  if(!frame||frame.disabled||!object(value))throw Error('LIGHT_DETAILS_REQUEST_INVALID');
  if(Object.keys(value).sort().join(',')!=='epoch,light,lightId,principalId,requestId,sequence,settings,tenantId,type,version'||value.version!==1||value.type!=='set-light-details'||!uuid(value.requestId)||!uuid(value.lightId)||value.epoch!==frame.epoch||value.sequence!==frame.sequence||value.tenantId!==frame.tenantId||value.principalId!==frame.principalId||new TextEncoder().encode(JSON.stringify(value)).length>65536)throw Error('LIGHT_DETAILS_REQUEST_STALE');
  if(!object(value.light)||Object.hasOwn(value.light,'id')||!object(value.light.transform)||!object(value.settings)||Object.hasOwn(value.settings,'lightId')||!frame.draft.candidate.lights.some(l=>l.id.toLowerCase()===(value.lightId as string).toLowerCase()))throw Error('LIGHT_DETAILS_SOURCE_INVALID');
  return structuredClone(value) as unknown as LightDetailsRequest;
}
export function nativeLightDetailsCandidate(frame:NativeViewportFrame,input:unknown){
  const request=checkedLightDetailsRequest(input,frame);
  if(!validateDraft(frame.draft).valid)throw Error('LIGHT_DETAILS_SOURCE_INVALID');
  const candidate=setLightDetails(frame.draft.candidate,request.lightId,request.light,request.settings);
  if(!validateDraft({...frame.draft,candidate}).valid)throw Error('LIGHT_DETAILS_CANDIDATE_INVALID');return candidate;
}
