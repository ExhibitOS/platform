// SPDX-License-Identifier: AGPL-3.0-or-later
// Framing and MAC only: caller must independently bind the inherited FD and
// named root/lock to these fields before sending an ACK or admitting a writer.
import {createHmac,timingSafeEqual} from 'node:crypto';
const kinds=['furnishing-writer-lease','furnishing-writer-lease-ack'];
const keys=['workspaceId','tenantId','principalId','runtimeGeneration','mode','payloadManifestSHA256','rootDevice','rootInode','lockDevice','lockInode'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const u64max=(1n<<64n)-1n;
function decimal(value,positive=false){if(typeof value!=='string'||! /^(?:0|[1-9][0-9]{0,19})$/.test(value))throw Error('FURNISHING_LEASE_INVALID');const n=BigInt(value);if(n>u64max||positive&&n===0n)throw Error('FURNISHING_LEASE_INVALID');return n;}
function checkedFields(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error('FURNISHING_LEASE_INVALID');
 for(const key of keys.slice(0,4))if(typeof value[key]!=='string'||!uuid.test(value[key]))throw Error('FURNISHING_LEASE_INVALID');
 if(!['workspace-furnishing-036-initialize-v1','workspace-furnishing-036-reopen-v1','workspace-furnishing-038-selected-import-v7','workspace-furnishing-039-selected-import-v7','workspace-furnishing-040-selected-import-v7','workspace-furnishing-039-to-040-upgrade-v1','workspace-furnishing-040-to-044-upgrade-v1','workspace-furnishing-044-to-045-upgrade-v1','workspace-furnishing-045-to-050-upgrade-v1','workspace-furnishing-045-to-049-upgrade-v1'].includes(value.mode)||typeof value.payloadManifestSHA256!=='string'||!hash.test(value.payloadManifestSHA256))throw Error('FURNISHING_LEASE_INVALID');
 decimal(value.rootDevice);decimal(value.rootInode,true);decimal(value.lockDevice);decimal(value.lockInode,true);
 return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
function mac(kind,fields,secret){
 if(!kinds.includes(kind)||!Buffer.isBuffer(secret)||secret.length!==32)throw Error('FURNISHING_LEASE_INVALID');
 const ids=keys.slice(0,4).map(key=>Buffer.from(fields[key].replaceAll('-',''),'hex'));
 const words=['rootDevice','rootInode','lockDevice','lockInode'].map(key=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(decimal(fields[key],key.endsWith('Inode')));return bytes;});
 return createHmac('sha256',secret).update(Buffer.concat([Buffer.from(`ExhibitOS/workspace-furnishing/${kind}/v1\0`,'ascii'),...ids,Buffer.from([fields.mode==='workspace-furnishing-036-initialize-v1'?1:fields.mode==='workspace-furnishing-036-reopen-v1'?2:fields.mode==='workspace-furnishing-038-selected-import-v7'?3:fields.mode==='workspace-furnishing-039-selected-import-v7'?4:fields.mode==='workspace-furnishing-040-selected-import-v7'?5:fields.mode==='workspace-furnishing-039-to-040-upgrade-v1'?6:fields.mode==='workspace-furnishing-040-to-044-upgrade-v1'?7:fields.mode==='workspace-furnishing-044-to-045-upgrade-v1'?8:fields.mode==='workspace-furnishing-045-to-050-upgrade-v1'?9:10]),Buffer.from(fields.payloadManifestSHA256,'hex'),...words])).digest('hex');
}
/** Build one canonical body; transport applies the existing 4-byte frame. */
export function encodeFurnishingLeaseFrame(kind,fields,secret){
 const value=checkedFields(fields),signature=mac(kind,value,secret);return Buffer.from(JSON.stringify({version:1,kind,...value,mac:signature}),'utf8');
}
/** Return authenticated fields only after strict bytes and expected binding
 * match. Receiving this frame does not itself prove an FD is held. */
export function authenticateFurnishingLeaseFrame(bytes,kind,secret){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>2048||!kinds.includes(kind))throw Error('FURNISHING_LEASE_INVALID');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('FURNISHING_LEASE_INVALID');}
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||value.kind!==kind||typeof value.mac!=='string'||!hash.test(value.mac))throw Error('FURNISHING_LEASE_INVALID');
 const fields=checkedFields(Object.fromEntries(keys.map(key=>[key,value[key]]))),canonical=Buffer.from(JSON.stringify({version:1,kind,...fields,mac:value.mac}),'utf8');
 if(!Buffer.from(bytes).equals(canonical)||!timingSafeEqual(Buffer.from(value.mac,'hex'),Buffer.from(mac(kind,fields,secret),'hex')))throw Error('FURNISHING_LEASE_INVALID');
 return fields;
}
export function verifyFurnishingLeaseFrame(bytes,kind,expected,secret){
 const fields=authenticateFurnishingLeaseFrame(bytes,kind,secret),bound=checkedFields(expected);if(keys.some(key=>fields[key]!==bound[key]))throw Error('FURNISHING_LEASE_INVALID');return fields;
}
