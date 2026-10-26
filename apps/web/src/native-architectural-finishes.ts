// SPDX-License-Identifier: AGPL-3.0-or-later
import {applyArchitecturalFinishCommand} from '@exhibitos/studio-contract';
import type {ArchitecturalFinishCommand} from '@exhibitos/studio-contract';
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {validateDraft} from './drafts/validator';
export const NATIVE_ARCHITECTURAL_FINISH_CAPABILITY='architectural-finishes-v1' as const;
export type ArchitecturalFinishRequest = CatalogBinding & ArchitecturalFinishCommand;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function checkedArchitecturalFinishRequest(value:unknown,frame:NativeViewportFrame|undefined):ArchitecturalFinishRequest {
  if(!frame||frame.disabled||!object(value))throw Error('ARCHITECTURAL_FINISH_REQUEST_INVALID');
  const keys=['epoch','principalId','requestId','sequence','tenantId','type','version'];
  if(value.type==='remove-wall-finish')keys.push('surfaceId');
  else if(value.type==='set-wall-finish'){keys.push('wall');}
  else throw Error('ARCHITECTURAL_FINISH_REQUEST_INVALID');
  if(Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.version!==1||!uuid(value.requestId)||value.epoch!==frame.epoch||value.sequence!==frame.sequence||value.tenantId!==frame.tenantId||value.principalId!==frame.principalId||new TextEncoder().encode(JSON.stringify(value)).length>65536)throw Error('ARCHITECTURAL_FINISH_REQUEST_STALE');
  if(value.type==='remove-wall-finish'?!uuid(value.surfaceId):!object(value.wall)||!uuid(value.wall.surfaceId))throw Error('ARCHITECTURAL_FINISH_SOURCE_INVALID');
  return structuredClone(value) as unknown as ArchitecturalFinishRequest;
}
/** Candidate is a narrow pure delta; native host validates that same delta before history commit. */
export function nativeArchitecturalFinishCandidate(frame:NativeViewportFrame,input:unknown){
  const request=checkedArchitecturalFinishRequest(input,frame);
  if(!validateDraft(frame.draft).valid)throw Error('ARCHITECTURAL_FINISH_SOURCE_INVALID');
  const candidate=applyArchitecturalFinishCommand(frame.draft.candidate,request);
  if(!validateDraft({...frame.draft,candidate}).valid)throw Error('ARCHITECTURAL_FINISH_CANDIDATE_INVALID');
  return candidate;
}
