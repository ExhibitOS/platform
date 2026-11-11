// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
export type MaterialBatchPhase='prepare'|'header'|'policy'|'write'|'fence'|'complete';
export type MaterialBatchCategory='complete'|'timeout'|'query-cancelled'|'lock-unavailable'|'abort'|'policy'|'fence'|'transport'|'internal';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
/** Only fixed categories are retained; never serialize the error or its message. */
export function materialBatchFailureCategory(error:unknown,phase:MaterialBatchPhase,aborted:boolean):MaterialBatchCategory {
 let name:unknown,code:unknown;
 try{if(error&&typeof error==='object'){const e=error as {name?:unknown;code?:unknown};name=e.name;code=e.code;}}catch{/* Uninspectable errors must not break cleanup. */}
 if(name==='TimeoutError')return 'timeout';
 if(code==='57014')return 'query-cancelled';if(code==='55P03')return 'lock-unavailable';
 if(aborted||name==='AbortError')return 'abort';
 if(phase==='policy')return 'policy';if(phase==='fence')return 'fence';
 if(phase==='header'||phase==='write')return 'transport';return 'internal';
}
/** Existing API stderr only: two bounded records per admitted native request,
 * no durable ledger and no client-supplied correlation/header/URL/body fields. */
export function materialBatchDiagnostic(enabled:boolean,publicationId:string,sink:(line:string)=>void=line=>console.error(line)){
 const requestId=randomUUID(),started=performance.now();let phase:MaterialBatchPhase='prepare',materialId:string|undefined,done=false;
 const emit=(event:'begin'|'terminal',category?:MaterialBatchCategory)=>{
  if(!enabled)return;
  const record={event,requestId,at:new Date().toISOString(),elapsedMs:Math.max(0,Math.round(performance.now()-started)),phase,
   ...(uuid.test(publicationId)?{publicationId}:{}),...(materialId&&uuid.test(materialId)?{materialId}:{}),...(category?{category}:{})};
  try{sink('WORKSPACE_MATERIAL_BATCH '+JSON.stringify(record));}catch{/* Diagnostics must never change stream or authority behavior. */}
 };
 emit('begin');
 return {
  phase(next:MaterialBatchPhase,id?:string){phase=next;materialId=id;},
  end(category:MaterialBatchCategory){if(done)return;done=true;emit('terminal',category);},
  failure(error:unknown,aborted:boolean){if(done)return;done=true;emit('terminal',materialBatchFailureCategory(error,phase,aborted));},
 };
}
