// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,fstatSync,chmodSync,linkSync,symlinkSync,mkdirSync,realpathSync} from 'node:fs';
import {mkdtemp,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectFurnishingWriterFd} from './native-workspace-furnishing-fd.mjs';
async function fixture(){const root=realpathSync(await mkdtemp(join(tmpdir(),'furnishing-fd-'))),path=join(root,'native-workspace-furnishing-writers.lock'),extra=[];let fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);while(fd<10){extra.push(fd);fd=openSync(path,constants.O_RDWR);}const r=openSyncRoot(root),w=fstatSync(fd,{bigint:true});return {root,path,fd,extra,input:{writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:join(root,'blobs'),configRoot:join(root,'config'),lease:{rootDevice:String(r.dev),rootInode:String(r.ino),lockDevice:String(w.dev),lockInode:String(w.ino)}}};}
function openSyncRoot(root){const fd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY);const stat=fstatSync(fd,{bigint:true});closeSync(fd);return stat;}
async function cleanup(f){closeSync(f.fd);for(const fd of f.extra)closeSync(fd);await rm(f.root,{recursive:true,force:true});}
test('binds a private named lock and root to the retained descriptor without closing it',async()=>{const f=await fixture();try{assert.deepEqual(inspectFurnishingWriterFd(f.input),{root:f.root,writerFd:f.fd});assert(fstatSync(f.fd).isFile());mkdirSync(f.input.blobRoot,{mode:0o700});mkdirSync(f.input.configRoot,{mode:0o700});assert.equal(inspectFurnishingWriterFd(f.input).writerFd,f.fd);}finally{await cleanup(f);}});
test('rejects mismatched scope, descriptors, permissions, hardlinks and replaced names',async()=>{for(const scenario of ['scope','owner','mode','hardlink','replace','symlink-child']){const f=await fixture();try{if(scenario==='scope')f.input.lease.rootInode='999';if(scenario==='owner')f.input.ownerFd=String(f.fd);if(scenario==='mode')chmodSync(f.path,0o644);if(scenario==='hardlink')linkSync(f.path,join(f.root,'alias'));if(scenario==='replace'){await rename(f.path,f.path+'.old');const next=openSync(f.path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);closeSync(next);}if(scenario==='symlink-child')symlinkSync(f.root,f.input.blobRoot);assert.throws(()=>inspectFurnishingWriterFd(f.input),/FURNISHING_WRITER_FD_INVALID/);}finally{await cleanup(f);}}});
