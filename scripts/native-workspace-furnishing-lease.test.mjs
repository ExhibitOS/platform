// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFurnishingLeaseFrame,verifyFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const secret=Buffer.from(Array.from({length:32},(_,i)=>i));
const fields={workspaceId:id(1),tenantId:id(2),principalId:id(3),runtimeGeneration:id(4),mode:'workspace-furnishing-036-initialize-v1',payloadManifestSHA256:Buffer.from(Array.from({length:32},(_,i)=>i+32)).toString('hex'),rootDevice:'7',rootInode:'9007199254740993',lockDevice:'7',lockInode:'9007199254740997'};
const lease='furnishing-writer-lease',ack='furnishing-writer-lease-ack';
test('matches the independently shared large-u64 lease and ack vectors',()=>{
 const frame=encodeFurnishingLeaseFrame(lease,fields,secret),reply=encodeFurnishingLeaseFrame(ack,fields,secret);
 assert.equal(JSON.parse(frame).mac,'8e0f0647ab4c55a17f9603ee76cf37855929b8eff27a6220aba7c46e8cfdb90f');
 assert.equal(JSON.parse(reply).mac,'ada68e6943e3e1481722829ec70fbbf80c91d185db3077fb871a98d3f48fd25d');
 assert.deepEqual(verifyFurnishingLeaseFrame(frame,lease,fields,secret),fields);assert.deepEqual(verifyFurnishingLeaseFrame(reply,ack,fields,secret),fields);
});
test('rejects altered scope, wrong key and frame kind, noncanonical JSON and duplicate keys',()=>{
 const valid=encodeFurnishingLeaseFrame(lease,fields,secret),json=valid.toString();
 for(const bytes of [Buffer.from(json+' '),Buffer.from(json.replace('"version":1','"version":1,"version":1')),Buffer.from(json.replace('"version":1,"kind"','"kind":"wrong","version":1,"kind"')),Buffer.from(json.replace('"rootDevice":"7"','"rootDevice":"07"')),Buffer.from(json.replace('"rootInode":"9007199254740993"','"rootInode":9007199254740993')),Buffer.concat([valid,Buffer.alloc(2049)])])assert.throws(()=>verifyFurnishingLeaseFrame(bytes,lease,fields,secret),/FURNISHING_LEASE_INVALID/);
 assert.throws(()=>verifyFurnishingLeaseFrame(valid,ack,fields,secret),/FURNISHING_LEASE_INVALID/);assert.throws(()=>verifyFurnishingLeaseFrame(valid,lease,{...fields,runtimeGeneration:id(5)},secret),/FURNISHING_LEASE_INVALID/);assert.throws(()=>verifyFurnishingLeaseFrame(valid,lease,fields,Buffer.alloc(32,9)),/FURNISHING_LEASE_INVALID/);
});
test('enforces u64 bounds, canonical integers and strict expected fields',()=>{
 for(const changed of [{rootDevice:'18446744073709551616'},{rootInode:'0'},{lockInode:'01'},{lockDevice:'-1'},{payloadManifestSHA256:'A'.repeat(64)},{mode:'other'},{extra:true}])assert.throws(()=>encodeFurnishingLeaseFrame(lease,{...fields,...changed},secret),/FURNISHING_LEASE_INVALID/);
 const maximum={...fields,lockInode:'18446744073709551615'};assert.deepEqual(verifyFurnishingLeaseFrame(encodeFurnishingLeaseFrame(lease,maximum,secret),lease,maximum,secret),maximum);
});

test('selected 038 has a separate authenticated mode and cannot impersonate existing modes',()=>{
 const selected={...fields,mode:'workspace-furnishing-038-selected-import-v7'},frame=encodeFurnishingLeaseFrame(lease,selected,secret);
 assert.equal(JSON.parse(frame).mac,'813f55583aa1cd1b00dc638b206228e6fac1b2bddd51600a94a0a8cdb0cc07e2');
 assert.equal(JSON.parse(encodeFurnishingLeaseFrame(ack,selected,secret)).mac,'4e65a50d15bb2e610bce5bf35f04c2172374a32b160b2fc083df439bc544f7af');
 assert.deepEqual(verifyFurnishingLeaseFrame(frame,lease,selected,secret),selected);
 assert.throws(()=>verifyFurnishingLeaseFrame(frame,lease,fields,secret),/FURNISHING_LEASE_INVALID/);
 assert.notEqual(JSON.parse(frame).mac,JSON.parse(encodeFurnishingLeaseFrame(lease,fields,secret)).mac);
});

test('039 selected lease uses the agreed separate HMAC tag',()=>{
 const selected={...fields,mode:'workspace-furnishing-039-selected-import-v7'};
 assert.equal(JSON.parse(encodeFurnishingLeaseFrame(lease,selected,secret)).mac,'88e2a5d1cdc86eaac30f63b83c4587aedfd9f397ad5b8cae7db0921a6bc5f75c');
 assert.equal(JSON.parse(encodeFurnishingLeaseFrame(ack,selected,secret)).mac,'a212cd112ad2a15d4951cf4899f4142770bcdbbfdf3d34c107c0125f7bcb6856');
});
