// SPDX-License-Identifier: AGPL-3.0-or-later
import {setSpaceLighting,validateSpaceLighting,SPACE_LIGHTING_NAMESPACE,type SpaceLighting} from '@exhibitos/studio-contract';
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {validateDraft} from './drafts/validator';
export const NATIVE_SPACE_SETTINGS_CAPABILITY='space-settings-v1' as const;
export interface SpaceSettingsRequest extends CatalogBinding {type:'set-space-lighting';settings:SpaceLighting|null}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function checkedSpaceSettingsRequest(value:unknown,frame:NativeViewportFrame|undefined):SpaceSettingsRequest {
  if(!frame||frame.disabled||!object(value))throw Error('SPACE_SETTINGS_REQUEST_INVALID');
  if(Object.keys(value).sort().join(',')!=='epoch,principalId,requestId,sequence,settings,tenantId,type,version'||value.version!==1||value.type!=='set-space-lighting'||!uuid(value.requestId)||value.epoch!==frame.epoch||value.sequence!==frame.sequence||value.tenantId!==frame.tenantId||value.principalId!==frame.principalId)throw Error('SPACE_SETTINGS_REQUEST_STALE');
  if(value.settings!==null&&!validateSpaceLighting({extensions:{[SPACE_LIGHTING_NAMESPACE]:value.settings}}).valid)throw Error('SPACE_SETTINGS_REQUEST_INVALID');
  return structuredClone(value) as unknown as SpaceSettingsRequest;
}
export function nativeSpaceSettingsCandidate(frame:NativeViewportFrame,input:unknown){
  const request=checkedSpaceSettingsRequest(input,frame);
  if(!validateDraft(frame.draft).valid)throw Error('SPACE_SETTINGS_SOURCE_INVALID');
  const candidate=setSpaceLighting(frame.draft.candidate,request.settings);
  if(!validateDraft({...frame.draft,candidate}).valid)throw Error('SPACE_SETTINGS_CANDIDATE_INVALID');
  return candidate;
}
