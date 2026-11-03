// SPDX-License-Identifier: AGPL-3.0-or-later
import {parseNativeOwnerOperation,type OwnerStageBound} from './native-owner-protocol.ts';
type Channel={send(value:Uint8Array):Promise<void>;close():Promise<void>};
type Identity=Pick<OwnerStageBound,'correlationId'|'runtimeGeneration'|'workspaceId'|'tenantId'|'jobId'|'attemptId'|'generation'|'stageId'|'reservationId'|'reservationGeneration'> & {stageDevice:string};
/** Correlates the Manager's pinned stage-file identity with an already
 * authenticated, provider-bound claim. A reply is not proof of the file,
 * process drain or reservation authority; caller retains the exact Session,
 * operation fence and owned claim throughout. */
export async function acceptOexOwnerStage(channel:Channel,raw:Uint8Array,identity:Identity,verifyLive:()=>Promise<void>,signal:AbortSignal,variant?:'v3'){
 try{
  if(!channel||typeof channel.send!=='function'||typeof channel.close!=='function'||!identity||typeof verifyLive!=='function'||!signal||variant!==undefined&&variant!=='v3')throw Error('OEX_OWNER_STAGE');
  const frame=parseNativeOwnerOperation(raw);if(frame.kind!==(variant==='v3'?'stage-bound-v3':'stage-bound'))throw Error('OEX_OWNER_STAGE');
  if(frame.kind!=='stage-bound'&&frame.kind!=='stage-bound-v3')throw Error('OEX_OWNER_STAGE');
  for(const key of ['correlationId','runtimeGeneration','workspaceId','tenantId','jobId','attemptId','generation','stageId','reservationId','reservationGeneration','stageDevice'] as const)if(frame[key]!==identity[key])throw Error('OEX_OWNER_STAGE');
  signal.throwIfAborted();await verifyLive();signal.throwIfAborted();
  await channel.send(Buffer.from(JSON.stringify({...frame,kind:variant==='v3'?'stage-accepted-v3':'stage-accepted'})));signal.throwIfAborted();
  return Object.freeze({stageDevice:frame.stageDevice,stageInode:frame.stageInode});
 }catch(error){if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}
}
