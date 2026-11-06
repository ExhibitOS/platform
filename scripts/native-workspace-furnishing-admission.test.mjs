// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,fstatSync,realpathSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {acceptFurnishingWriterLease} from './native-workspace-furnishing-admission.mjs';
import {encodeFurnishingLeaseFrame,verifyFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,secret=Buffer.from(Array.from({length:32},(_,i)=>i));
async function fixture(){
 const root=realpathSync(await mkdtemp(join(tmpdir(),'furnishing-admit-'))),lock=join(root,'native-workspace-furnishing-writers.lock'),extra=[];let fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);while(fd<10){extra.push(fd);fd=openSync(lock,constants.O_RDWR);}const rootFd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY),r=fstatSync(rootFd,{bigint:true}),w=fstatSync(fd,{bigint:true});closeSync(rootFd);
 const scope={workspaceId:id(1),tenantId:id(2),principalId:id(3),runtimeGeneration:id(4),mode:'workspace-furnishing-036-initialize-v1'},fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(r.dev),rootInode:String(r.ino),lockDevice:String(w.dev),lockInode:String(w.ino)};
 let open=true;const sent=[],channel={isOpen:()=>open,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async value=>{sent.push(value);},close:async()=>{open=false;}},payload={digest:fields.payloadManifestSHA256,verify:async()=>{}},input={channel,secret,scope,payload,writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:join(root,'blobs'),configRoot:join(root,'config')};return {root,fd,extra,fields,sent,input,close:()=>{open=false;}};
}
async function cleanup(f){closeSync(f.fd);for(const fd of f.extra)closeSync(fd);await rm(f.root,{recursive:true,force:true});}
test('authenticates scope, manifest and fd before emitting the exact ack',async()=>{const f=await fixture();try{const guard=await acceptFurnishingWriterLease(f.input);assert.equal(guard.writerFd,f.fd);assert.deepEqual(verifyFurnishingLeaseFrame(f.sent[0],'furnishing-writer-lease-ack',f.fields,secret),f.fields);await guard.assertLive();f.close();await assert.rejects(guard.assertLive(),/FURNISHING_LEASE_INVALID/);}finally{await cleanup(f);}});
test('wrong owner binding, payload or fd fails before any ack',async()=>{for(const scenario of ['owner','payload','fd']){const f=await fixture();try{if(scenario==='owner')f.input.scope={...f.input.scope,principalId:id(5)};if(scenario==='payload')f.input.payload.digest='b'.repeat(64);if(scenario==='fd')f.input.writerFd='3';await assert.rejects(acceptFurnishingWriterLease(f.input));assert.equal(f.sent.length,0);assert.equal(f.input.channel.isOpen(),false);}finally{await cleanup(f);}}});
test('a stalled payload check times out and cannot send a later ack',async t=>{const f=await fixture();t.mock.timers.enable({apis:['setTimeout']});try{let release;f.input.payload.verify=()=>new Promise(resolve=>{release=resolve;});const pending=acceptFurnishingWriterLease(f.input);t.mock.timers.tick(5000);await assert.rejects(pending,/FURNISHING_LEASE_INVALID/);release();await Promise.resolve();assert.equal(f.sent.length,0);assert.equal(f.input.channel.isOpen(),false);}finally{t.mock.timers.reset();await cleanup(f);}});
