// SPDX-License-Identifier: AGPL-3.0-or-later
import {applyPlaqueCommand} from '@exhibitos/studio-contract';
import type {PlaqueCommand} from '@exhibitos/studio-contract';
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {validateDraft} from './drafts/validator';
export const NATIVE_PLAQUE_INSPECTOR_CAPABILITY='plaque-inspector-v1' as const;
export type PlaqueInspectorRequest = CatalogBinding & PlaqueCommand;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function checkedPlaqueInspectorRequest(value:unknown,frame:NativeViewportFrame|undefined):PlaqueInspectorRequest {
  if(!frame||frame.disabled||!object(value))throw Error('PLAQUE_INSPECTOR_REQUEST_INVALID');
  const keys=['epoch','principalId','requestId','sequence','tenantId','type','version'];
  if(value.type==='remove-plaque')keys.push('plaqueId');
  else if(value.type==='add-plaque'||value.type==='set-plaque'){keys.push('plaque');}
  else throw Error('PLAQUE_INSPECTOR_REQUEST_INVALID');
  if(Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.version!==1||!uuid(value.requestId)||value.epoch!==frame.epoch||value.sequence!==frame.sequence||value.tenantId!==frame.tenantId||value.principalId!==frame.principalId||new TextEncoder().encode(JSON.stringify(value)).length>65536)throw Error('PLAQUE_INSPECTOR_REQUEST_STALE');
  if(value.type==='remove-plaque'?!uuid(value.plaqueId):!object(value.plaque)||!uuid(value.plaque.id))throw Error('PLAQUE_INSPECTOR_SOURCE_INVALID');
  return structuredClone(value) as unknown as PlaqueInspectorRequest;
}
/** Candidate is a narrow pure delta; native host validates that same delta before history commit. */
export function nativePlaqueInspectorCandidate(frame:NativeViewportFrame,input:unknown){
  const request=checkedPlaqueInspectorRequest(input,frame);
  if(!validateDraft(frame.draft).valid)throw Error('PLAQUE_INSPECTOR_SOURCE_INVALID');
  const candidate=applyPlaqueCommand(frame.draft.candidate,request);
  if(!validateDraft({...frame.draft,candidate}).valid)throw Error('PLAQUE_INSPECTOR_CANDIDATE_INVALID');
  return candidate;
}
