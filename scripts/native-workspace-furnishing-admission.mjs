// SPDX-License-Identifier: AGPL-3.0-or-later
// Private handshake bound to the Manager lifecycle. It does not by itself
// prove prior-generation drain or authorize retained-token recovery.
import {authenticateFurnishingLeaseFrame,encodeFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
import {inspectFurnishingWriterFd} from './native-workspace-furnishing-fd.mjs';
import {createHash} from 'node:crypto';
import {authenticateFurnishingOrdinaryAssertion,encodeFurnishingOrdinaryAssertion,verifyFurnishingOrdinaryAssertion} from './native-workspace-furnishing-ordinary-assertion.mjs';
const scoped=['workspaceId','tenantId','principalId','runtimeGeneration','mode'];
const issued=new WeakSet(),issuedChannels=new WeakMap();
export function assertIssuedFurnishingWriterLease(value){if(!value||!issued.has(value))throw Error('FURNISHING_LEASE_INVALID');}
export async function acceptFurnishingWriterLease({channel,secret,scope,payload,writerFd,ownerFd,blobRoot,configRoot}){
 if(!channel||typeof channel.receive!=='function'||typeof channel.send!=='function'||typeof channel.close!=='function'||!channel.isOpen?.()||!(secret instanceof Uint8Array)||secret.byteLength!==32||!payload||typeof payload.verify!=='function'||typeof payload.digest!=='string'||!/^[a-f0-9]{64}$/.test(payload.digest)||!scope||Object.keys(scope).length!==scoped.length||scoped.some(k=>typeof scope[k]!=='string'))throw Error('FURNISHING_LEASE_INVALID');
 const manifestDigest=payload.digest,verifyPayload=payload.verify.bind(payload),manifest=()=>{if(payload.digest!==manifestDigest)throw Error('FURNISHING_LEASE_INVALID');};
 const key=Buffer.from(secret);let expired=false,invalid=false,timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;void channel.close().catch(()=>{});reject(Error('FURNISHING_LEASE_INVALID'));},5000);});
 const live=()=>{if(expired||invalid||!channel.isOpen())throw Error('FURNISHING_LEASE_INVALID');};
 const exchange=async()=>{
  await verifyPayload();manifest();live();const frame=await channel.receive(0);manifest();live();const values=authenticateFurnishingLeaseFrame(frame,'furnishing-writer-lease',key);
  if(scoped.some(k=>values[k]!==scope[k])||values.payloadManifestSHA256!==manifestDigest)throw Error('FURNISHING_LEASE_INVALID');
  const identity=Object.freeze({...values}),inspect=()=>inspectFurnishingWriterFd({writerFd,ownerFd,blobRoot,configRoot,lease:identity}),inspected=inspect();
  await verifyPayload();manifest();live();inspect();live();await channel.send(encodeFurnishingLeaseFrame('furnishing-writer-lease-ack',identity,key));manifest();live();inspect();
  const guard=Object.freeze({identity,writerFd:inspected.writerFd,leaseTranscriptSHA256:createHash('sha256').update(frame).digest('hex'),assertLive:async()=>{try{manifest();live();inspect();await verifyPayload();manifest();live();inspect();live();}catch(error){invalid=true;void channel.close().catch(()=>{});throw error;}}});issued.add(guard);issuedChannels.set(guard,channel);return guard;
 };
 try{return await Promise.race([exchange(),deadline]);}catch(error){void channel.close().catch(()=>{});throw error;}finally{clearTimeout(timer);key.fill(0);}
}

// An authenticated assertion is useful only after a separately issued lease;
// the Manager remains responsible for durable Active transition semantics.
const ordinaryIssued=new WeakSet(),ordinaryConsumed=new WeakSet(),stopControls=new WeakSet();
export function assertIssuedFurnishingOrdinaryAdmission(value){if(!value||!ordinaryIssued.has(value))throw Error('FURNISHING_ADMISSION_INVALID');}
export async function acceptFurnishingOrdinaryAdmission({writer,channel,secret}){
 assertIssuedFurnishingWriterLease(writer);
 if(ordinaryConsumed.has(writer)||issuedChannels.get(writer)!==channel||!channel?.isOpen?.()||!(secret instanceof Uint8Array)||secret.byteLength!==32)throw Error('FURNISHING_ADMISSION_INVALID');
 ordinaryConsumed.add(writer);
 const key=Buffer.from(secret);
 try{
  await writer.assertLive();const frame=await channel.receive(5000);await writer.assertLive();const fields=authenticateFurnishingOrdinaryAssertion(frame,'furnishing-ordinary-admission',key);
  if(fields.runtimeGeneration!==writer.identity.runtimeGeneration||fields.leaseTranscriptSHA256!==writer.leaseTranscriptSHA256||(fields.admissionKind==='fresh-empty')!==(writer.identity.mode==='workspace-furnishing-036-initialize-v1'))throw Error('FURNISHING_ADMISSION_INVALID');
  await channel.send(encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission-ack',fields,key));await writer.assertLive();const admission=Object.freeze({fields:Object.freeze(fields),writer});ordinaryIssued.add(admission);return admission;
 }catch(error){void channel.close().catch(()=>{});throw error;}finally{key.fill(0);}
}

/** One authenticated normal-stop exchange on the same owner channel. The
 * caller must close admission synchronously when wait resolves and may send
 * drained only after all already-admitted work and the pool have settled. */
export function furnishingOrdinaryStopControl(admission,channel,secret){
 assertIssuedFurnishingOrdinaryAdmission(admission);
 if(stopControls.has(admission)||issuedChannels.get(admission.writer)!==channel||!(secret instanceof Uint8Array)||secret.byteLength!==32)throw Error('FURNISHING_ADMISSION_INVALID');
 stopControls.add(admission);
 const key=Buffer.from(secret);let started=false,requested=false,verified=false,finished=false;
 return Object.freeze({
  wait:async()=>{if(started||finished)throw Error('FURNISHING_ADMISSION_INVALID');started=true;try{const frame=await channel.receive(0);await admission.writer.assertLive();verifyFurnishingOrdinaryAssertion(frame,'furnishing-ordinary-stop',admission.fields,key);if(!channel.isOpen())throw Error('FURNISHING_ADMISSION_INVALID');requested=true;}catch(error){finished=true;key.fill(0);void channel.close().catch(()=>{});throw error;}},
  verify:async()=>{if(!requested||finished||verified||!channel.isOpen())throw Error('FURNISHING_ADMISSION_INVALID');await admission.writer.assertLive();if(!channel.isOpen())throw Error('FURNISHING_ADMISSION_INVALID');verified=true;},
  drained:async()=>{if(!requested||!verified||finished||!channel.isOpen())throw Error('FURNISHING_ADMISSION_INVALID');finished=true;try{await channel.send(encodeFurnishingOrdinaryAssertion('furnishing-ordinary-drained',admission.fields,key));}finally{key.fill(0);}},
  dispose:()=>{finished=true;key.fill(0);},
 });
}

export async function finalizeFurnishingOrdinaryStop(control,closePayload,isFailed){
 const healthy=()=>{if(isFailed())throw Error('LOCAL_RUNTIME_CLOSE_FAILED');};
 healthy();await control.verify();healthy();await closePayload();healthy();await control.drained();
}
