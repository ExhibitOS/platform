// SPDX-License-Identifier: AGPL-3.0-or-later
/** Fresh-isolated validation diagnostics only. Values are fixed allowlists;
 * never print raw errors, paths, IDs, tokens, input bytes or DB messages.
 * Stages and channel state are local observations, not peer receipt, durable
 * completion, worker drain or proof of which side closed first. */
const stages=['owner-start','owner-selected','owner-snapshot','claim-start','claim-persisted','reservation-acquired','binding-persisted','binding-verified','lease-start','lease-returned','lease-committed','prepare-start','prepare-verified','claim-ready-start','claim-ready-sent','stage-received','control-received','metadata-received','consume-start','consume-complete','drain-complete','final-start','final-returned','commit-acknowledged','save-ready-send-start','completion-send-start'] as const;
export type NativeOexDiagnosticStage=typeof stages[number];
const errors=['NATIVE_OEX_OWNER','OEX_OWNER_CLAIM','OEX_OWNER_OPERATION','OEX_BOUNDED_PREPARE','OEX_JOB_INVALID','OEX_LEASE_UNAVAILABLE','OEX_TRANSACTION_UNSUPPORTED','OEX_OWNER_AUTH','FILE_OPERATION_BUSY','FILE_OPERATION_COMMIT_UNCERTAIN','FILE_OPERATION_POSTCOMMIT_FAILED','PUBLICATION_CLAIM_UNCERTAIN','PUBLICATION_CLAIM_BINDING','PUBLICATION_CLAIM_UNBOUND','PUBLICATION_ATTEMPT_ROOT','NATIVE_OWNER_UNAVAILABLE','55P03','57014','23514'] as const;
type Observation='open'|'closed'|'unknown';
export interface NativeOexDiagnostic {step(stage:NativeOexDiagnosticStage):void;fail(error:unknown,channel:unknown):void;report():string}
export function createNativeOexDiagnostic():NativeOexDiagnostic{
 let stage:NativeOexDiagnosticStage='owner-start',errorCode:string='OTHER',observation:Observation='unknown',failed=false;
 return {
  step(value){if(!failed&&stages.includes(value))stage=value;},
  fail(error,channel){if(failed)return;failed=true;try{const candidate=error&&typeof error==='object'&&'code' in error?error.code:undefined;const message=error instanceof Error?error.message:undefined;const value=typeof candidate==='string'&&errors.some(x=>x===candidate)?candidate:typeof message==='string'&&errors.some(x=>x===message)?message:'OTHER';errorCode=value;const ch=channel as {isOpen?:()=>boolean}|undefined;observation=typeof ch?.isOpen==='function'?(ch.isOpen()?'open':'closed'):'unknown';}catch{errorCode='OTHER';observation='unknown';}},
  report(){return `NATIVE_OEX_DIAGNOSTIC ${stage} ${errorCode} ${observation}`;},
 };
}

/** Fixed private selected-flow observations; no request data or error text. */
const selectedEvents=['put-received','put-admitted','put-body-matched','put-commit-returned','put-scope-returned','put-rejected','save-observed-received','save-observed-frame-validated','put-observer-resolved','independent-reopen-matched','save-verified-sent','postsave-scope-returned','postsave-check-start','postsave-check-returned','unlock-start','unlock-returned','unlock-failed','unlock-skipped','lifecycle-returned','upload-drain-start','upload-drain-returned','save-drain-start','save-drain-returned','final-live-start','final-live-returned','complete-send-start','complete-send-returned'] as const;
export type NativeOexSelectedEvent=typeof selectedEvents[number];
export function traceNativeOexSelected(event:NativeOexSelectedEvent):void{
 if(!selectedEvents.includes(event))return;
 try{console.error(`NATIVE_OEX_SELECTED ${event}`);}catch{/* Diagnostics must not change operation outcome. */}
}
