// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,realpathSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {encodeFurnishingLeaseFrame,verifyFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
import {acceptFurnishingWriterLease,acceptFurnishingOrdinaryAdmission,assertIssuedFurnishingOrdinaryAdmission} from './native-workspace-furnishing-admission.mjs';
import {encodeFurnishingOrdinaryAssertion,authenticateFurnishingOrdinaryAssertion,verifyFurnishingOrdinaryAssertion} from './native-workspace-furnishing-ordinary-assertion.mjs';
import {unpackNativeOwnerInput} from './native-owner-channel.mjs';
const mode='workspace-furnishing-045-to-050-upgrade-v1',admissionKind='catalog-upgrade-045-to-050',secret=Buffer.alloc(32,7),id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function carried(){return {restoreId:id(10),backupId:id(11),authenticatedManifestSha256:'f'.repeat(64),observation:{version:1,sourceHandoffSha256:'e'.repeat(64),priorRestoreProof:{restoreId:id(12),backupId:id(13),authenticatedManifestSha256:'c'.repeat(64),sourceDatabaseSystemId:'12',sourceDatabaseOid:'34',targetDatabaseSystemId:'56',targetDatabaseOid:'78',provenanceRowCount:1,provenanceTableSha256:'d'.repeat(64)},archiveSourceDatabaseSystemId:'56',archiveSourceDatabaseOid:'78',targetDatabaseSystemId:'90',targetDatabaseOid:'91',provenanceRowCount:1,provenanceTableSha256:'d'.repeat(64)}};}
async function fixture(selectedMode=mode){
 const root=realpathSync(await mkdtemp(join(tmpdir(),'thumbnail-upgrade-admission-'))),lock=join(root,'native-workspace-furnishing-writers.lock'),extra=[];let fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);while(fd<10){extra.push(fd);fd=openSync(lock,constants.O_RDWR);}const rootFd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY),r=fstatSync(rootFd,{bigint:true}),w=fstatSync(fd,{bigint:true});closeSync(rootFd);
 const scope={workspaceId:id(1),tenantId:id(2),principalId:id(3),runtimeGeneration:id(4),mode:selectedMode},fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(r.dev),rootInode:String(r.ino),lockDevice:String(w.dev),lockInode:String(w.ino)};
 let live=true;const sent=[],channel={isOpen:()=>live,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async bytes=>{sent.push(bytes);},close:async()=>{live=false;}},payload={digest:fields.payloadManifestSHA256,verify:async()=>{}};
 return {root,fd,extra,fields,sent,input:{channel,secret,scope,payload,writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:join(root,'blobs'),configRoot:join(root,'config')}};
}
async function cleanup(f){closeSync(f.fd);for(const fd of f.extra)closeSync(fd);await rm(f.root,{recursive:true,force:true});}
function leaseMac(fields,ordinal){const words=['rootDevice','rootInode','lockDevice','lockInode'].map(k=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(fields[k]));return b;});return createHmac('sha256',secret).update(Buffer.concat([Buffer.from('ExhibitOS/workspace-furnishing/furnishing-writer-lease/v1\0','ascii'),...['workspaceId','tenantId','principalId','runtimeGeneration'].map(k=>Buffer.from(fields[k].replaceAll('-',''),'hex')),Buffer.from([ordinal]),Buffer.from(fields.payloadManifestSHA256,'hex'),...words])).digest('hex');}
function ordinaryMac(fields,ordinal){const proof=fields.carriedRestoreProof;return createHmac('sha256',secret).update(Buffer.concat([Buffer.from(`ExhibitOS/workspace-furnishing/furnishing-ordinary-admission/v${proof?4:fields.previousRuntimeGeneration?3:1}\0`,'ascii'),Buffer.from(fields.runtimeGeneration.replaceAll('-',''),'hex'),Buffer.from(fields.leaseTranscriptSHA256,'hex'),Buffer.from([ordinal]),Buffer.from(fields.activeBindingSHA256,'hex'),...(proof?[createHash('sha256').update(JSON.stringify(proof)).digest()]:[]),...(fields.previousRuntimeGeneration?[Buffer.from(fields.previousRuntimeGeneration.replaceAll('-',''),'hex')]:[])])).digest('hex');}
test('appends lease mode9 and admission kind8 without renumbering prior upgrade or interrupted-reopen wire values',async()=>{
 const f=await fixture();try{for(const [selectedMode,ordinal]of[[mode,9],['workspace-furnishing-044-to-045-upgrade-v1',8],['workspace-furnishing-040-to-044-upgrade-v1',7]]){const fields={...f.fields,mode:selectedMode},frame=encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret);assert.equal(JSON.parse(frame).mac,leaseMac(fields,ordinal));assert.deepEqual(verifyFurnishingLeaseFrame(frame,'furnishing-writer-lease',fields,secret),fields);}
 const fields={runtimeGeneration:id(4),leaseTranscriptSHA256:'a'.repeat(64),admissionKind,activeBindingSHA256:'b'.repeat(64),carriedRestoreProof:carried()},frame=encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);assert.equal(JSON.parse(frame).version,4);assert.equal(JSON.parse(frame).mac,ordinaryMac(fields,8));
 const old={runtimeGeneration:id(4),leaseTranscriptSHA256:'a'.repeat(64),admissionKind:'catalog-upgrade-044-to-045',activeBindingSHA256:'b'.repeat(64)};assert.equal(JSON.parse(encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',old,secret)).mac,ordinaryMac(old,6));
 const interrupted={...old,admissionKind:'interrupted-reopen',previousRuntimeGeneration:id(99)};assert.equal(JSON.parse(encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',interrupted,secret)).mac,ordinaryMac(interrupted,7));
 }finally{await cleanup(f);}
});
test('requires the sealed owner envelope and permits only the new fixed mode, not arbitrary upgrade authority',()=>{
 const ownerChannel={version:3,runtimeGeneration:id(4),secret:secret.toString('hex'),mode},workspace={id:id(1)},hayesOwnerChannel={version:1,runtimeGeneration:id(4),secret:'8'.repeat(64),nativeOwnerId:id(8),runtimeManifestSha256:'a'.repeat(64)};
 assert.equal(unpackNativeOwnerInput({workspace,ownerChannel}).ownerChannel.mode,mode);assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel,hayesOwnerChannel}),/NATIVE_OWNER_INPUT/);
 for(const oldMode of ['workspace-furnishing-040-to-044-upgrade-v1','workspace-furnishing-044-to-045-upgrade-v1'])assert.equal(unpackNativeOwnerInput({workspace,ownerChannel:{...ownerChannel,mode:oldMode},hayesOwnerChannel}).hayesOwnerChannel.runtimeManifestSha256,'a'.repeat(64));
 for(const value of [{workspace,ownerChannel:{...ownerChannel,mode:'workspace-furnishing-arbitrary-upgrade-v1'}},{workspace,ownerChannel,sql:'anything'},{workspace,ownerChannel,hayesOwnerChannel:{...hayesOwnerChannel,runtimeGeneration:id(99)}}])assert.throws(()=>unpackNativeOwnerInput(value),/NATIVE_OWNER_INPUT/);
});
test('accepts only an actually issued temporary FD lease and preserves exact physical carried proof in all authenticated phases',async()=>{
 const f=await fixture();try{const writer=await acceptFurnishingWriterLease(f.input);assert.equal(writer.writerFd,f.fd);const fields={runtimeGeneration:id(4),leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind,activeBindingSHA256:'b'.repeat(64),carriedRestoreProof:carried()},before=structuredClone(fields);f.input.channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);
 await assert.rejects(acceptFurnishingOrdinaryAdmission({writer:{...writer},channel:f.input.channel,secret}),/FURNISHING_LEASE_INVALID/);
 const result=await acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret});assertIssuedFurnishingOrdinaryAdmission(result);assert.deepEqual(result.fields,before);assert.ok(Object.isFrozen(result.fields.carriedRestoreProof.observation.priorRestoreProof));assert.deepEqual(verifyFurnishingOrdinaryAssertion(f.sent[1],'furnishing-ordinary-admission-ack',before,secret),before);
 for(const step of ['furnishing-ordinary-admission','furnishing-ordinary-admission-ack','furnishing-ordinary-stop','furnishing-ordinary-drained'])assert.deepEqual(verifyFurnishingOrdinaryAssertion(encodeFurnishingOrdinaryAssertion(step,before,secret),step,before,secret),before);
 await assert.rejects(acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret}),/FURNISHING_ADMISSION_INVALID/);
 }finally{await cleanup(f);}
});
test('ordinary reopen and every other upgrade cannot acquire045→050 authority, with or without carried proof',async()=>{
 for(const [selectedMode,kind,proof]of[['workspace-furnishing-036-reopen-v1',admissionKind,true],[mode,'clean-reopen',true],['workspace-furnishing-044-to-045-upgrade-v1',admissionKind,true],[mode,'catalog-upgrade-044-to-045',false]]){const f=await fixture(selectedMode);try{const writer=await acceptFurnishingWriterLease(f.input),fields={runtimeGeneration:id(4),leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind:kind,activeBindingSHA256:'b'.repeat(64),...(proof?{carriedRestoreProof:carried()}:{})};f.input.channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);await assert.rejects(acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret}),/FURNISHING_ADMISSION_INVALID/);assert.equal(f.sent.length,1);}finally{await cleanup(f);}}
});
test('rejects payload/generation/physical-identity and authenticated binding/proof tampering before upgrade admission',async()=>{
 for(const field of ['payloadManifestSHA256','runtimeGeneration','lockInode']){const f=await fixture();try{const tampered={...f.fields,[field]:field==='runtimeGeneration'?id(99):field==='lockInode'?String(BigInt(f.fields.lockInode)+1n):'b'.repeat(64)};f.input.channel.receive=async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',tampered,secret);await assert.rejects(acceptFurnishingWriterLease(f.input),/FURNISHING_(?:LEASE|WRITER_FD)_INVALID/);assert.equal(f.sent.length,0);}finally{await cleanup(f);}}
 const fields={runtimeGeneration:id(4),leaseTranscriptSHA256:'a'.repeat(64),admissionKind,activeBindingSHA256:'b'.repeat(64),carriedRestoreProof:carried()},frame=encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);
 for(const key of ['activeBindingSHA256','leaseTranscriptSHA256','runtimeGeneration']){const altered=JSON.parse(frame);altered[key]=key==='runtimeGeneration'?id(99):'c'.repeat(64);assert.throws(()=>authenticateFurnishingOrdinaryAssertion(Buffer.from(JSON.stringify(altered)),'furnishing-ordinary-admission',secret),/FURNISHING_ADMISSION_INVALID/);}
 const bad=JSON.parse(frame);bad.carriedRestoreProof.observation.targetDatabaseSystemId='12';assert.throws(()=>authenticateFurnishingOrdinaryAssertion(Buffer.from(JSON.stringify(bad)),'furnishing-ordinary-admission',secret),/FURNISHING_ADMISSION_INVALID/);
 assert.throws(()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',{...fields,restoreProof:fields.carriedRestoreProof.observation.priorRestoreProof},secret),/FURNISHING_ADMISSION_INVALID/);
});

test('appends combined lease12/admission11 with carried proof and keeps051 wire values11/10',async()=>{
 const combined='workspace-furnishing-051-to-050-051-upgrade-v1',kind='catalog-upgrade-051-to-050-051',f=await fixture(combined);
 try{
  for(const [selectedMode,ordinal] of [[combined,12],['workspace-furnishing-045-to-051-upgrade-v1',11]]){
   const fields={...f.fields,mode:selectedMode},frame=encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret);assert.equal(JSON.parse(frame).mac,leaseMac(fields,ordinal));
  }
  const writer=await acceptFurnishingWriterLease(f.input),fields={runtimeGeneration:id(4),leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind:kind,activeBindingSHA256:'b'.repeat(64),carriedRestoreProof:carried()};
  const frame=encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);assert.equal(JSON.parse(frame).mac,ordinaryMac(fields,11));
  assert.equal(JSON.parse(encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',{...fields,admissionKind:'catalog-upgrade-045-to-051'},secret)).mac,ordinaryMac({...fields,admissionKind:'catalog-upgrade-045-to-051'},10));
  f.input.channel.receive=async()=>frame;const admission=await acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret});assert.deepEqual(admission.fields,fields);
  for(const step of ['furnishing-ordinary-stop','furnishing-ordinary-drained'])assert.deepEqual(verifyFurnishingOrdinaryAssertion(encodeFurnishingOrdinaryAssertion(step,fields,secret),step,fields,secret),fields);
 }finally{await cleanup(f);}
});
test('ordinary and051-only modes cannot claim the combined admission',async()=>{
 for(const selectedMode of ['workspace-furnishing-036-reopen-v1','workspace-furnishing-045-to-051-upgrade-v1']){
  const f=await fixture(selectedMode);try{const writer=await acceptFurnishingWriterLease(f.input),fields={runtimeGeneration:id(4),leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind:'catalog-upgrade-051-to-050-051',activeBindingSHA256:'b'.repeat(64)};f.input.channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);await assert.rejects(acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret}),/FURNISHING_ADMISSION_INVALID/);}finally{await cleanup(f);}
 }
});
