// SPDX-License-Identifier: AGPL-3.0-or-later
// Preparatory private handshake. Runtime admission remains separately disabled;
// this does not infer previous-generation drain or authorize token recovery.
import {authenticateFurnishingLeaseFrame,encodeFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
import {inspectFurnishingWriterFd} from './native-workspace-furnishing-fd.mjs';
const scoped=['workspaceId','tenantId','principalId','runtimeGeneration','mode'];
const issued=new WeakSet();
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
  const guard=Object.freeze({identity,writerFd:inspected.writerFd,assertLive:async()=>{try{manifest();live();inspect();await verifyPayload();manifest();live();inspect();live();}catch(error){invalid=true;void channel.close().catch(()=>{});throw error;}}});issued.add(guard);return guard;
 };
 try{return await Promise.race([exchange(),deadline]);}catch(error){void channel.close().catch(()=>{});throw error;}finally{clearTimeout(timer);key.fill(0);}
}
