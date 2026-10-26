// SPDX-License-Identifier: AGPL-3.0-or-later
import {applyBenchCommand} from '@exhibitos/studio-contract';
import type {BenchCommand} from '@exhibitos/studio-contract';
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {validateDraft} from './drafts/validator';
export const NATIVE_BENCH_INSPECTOR_CAPABILITY='bench-inspector-v1' as const;
export type BenchInspectorRequest = CatalogBinding & BenchCommand;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function checkedBenchInspectorRequest(value:unknown,frame:NativeViewportFrame|undefined):BenchInspectorRequest {
  if(!frame||frame.disabled||!object(value))throw Error('BENCH_INSPECTOR_REQUEST_INVALID');
  const keys=['epoch','principalId','requestId','sequence','tenantId','type','version'];
  if(value.type==='remove-bench')keys.push('benchId');
  else if(value.type==='add-bench'||value.type==='set-bench'){keys.push('bench');if(Object.hasOwn(value,'viewpoint'))keys.push('viewpoint');}
  else throw Error('BENCH_INSPECTOR_REQUEST_INVALID');
  if(Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.version!==1||!uuid(value.requestId)||value.epoch!==frame.epoch||value.sequence!==frame.sequence||value.tenantId!==frame.tenantId||value.principalId!==frame.principalId||new TextEncoder().encode(JSON.stringify(value)).length>65536)throw Error('BENCH_INSPECTOR_REQUEST_STALE');
  if(value.type==='remove-bench'?!uuid(value.benchId):!object(value.bench)||!uuid(value.bench.id))throw Error('BENCH_INSPECTOR_SOURCE_INVALID');
  return structuredClone(value) as unknown as BenchInspectorRequest;
}
/** Candidate is a narrow pure delta; native host validates that same delta before history commit. */
export function nativeBenchInspectorCandidate(frame:NativeViewportFrame,input:unknown){
  const request=checkedBenchInspectorRequest(input,frame);
  if(!validateDraft(frame.draft).valid)throw Error('BENCH_INSPECTOR_SOURCE_INVALID');
  const candidate=applyBenchCommand(frame.draft.candidate,request);
  if(!validateDraft({...frame.draft,candidate}).valid)throw Error('BENCH_INSPECTOR_CANDIDATE_INVALID');
  return candidate;
}
