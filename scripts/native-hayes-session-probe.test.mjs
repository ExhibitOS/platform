// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {openSync,fstatSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseProbeArm,metadata,readSource} from './native-hayes-session-probe.mjs';
import {validMetadata} from '../apps/api/dist/cms.js';
const id='00000000-0000-4000-8000-000000000001',hayes={runtimeGeneration:id,nativeOwnerId:id,runtimeManifestSha256:'a'.repeat(64)};
test('requires the exact private arm and preserves unknown source units in the fixture',()=>{
 const arm={version:1,kind:'hayes-session-probe-start',...hayes};assert.deepEqual(parseProbeArm(Buffer.from(JSON.stringify(arm)),hayes),arm);
 assert.throws(()=>parseProbeArm(Buffer.from(JSON.stringify({...arm,nativeOwnerId:'bad'})),hayes));assert.throws(()=>parseProbeArm(Buffer.from(JSON.stringify({...arm,extra:true})),hayes));
 const m=metadata();assert.equal(validMetadata(m),true);assert.equal(m.provenance.sourceUnits,'unknown');assert.equal(m.provenance.scaleApplied,false);assert.equal(m.displayReference.assetSha256,'694a9cf81dfbf12fd0841ae45240c5ae0f1d7cb129d0ee122be7cff86c4625bc');
});
test('validates and consumes the exact readonly source descriptor without taking an alias',()=>{
 if(!process.env.EXHIBITOS_HAYES_ORIGINAL)throw Error('probe test source missing');
 const fd=openSync(process.env.EXHIBITOS_HAYES_ORIGINAL,'r');assert(fd>=10);
 assert.throws(()=>readSource({EXHIBITOS_TEST_HAYES_SOURCE_FD:'0'+fd}));assert(fstatSync(fd).isFile());
 assert.throws(()=>readSource({EXHIBITOS_TEST_HAYES_SOURCE_FD:String(fd),EXHIBITOS_NATIVE_OWNER_FD:String(fd)}));assert(fstatSync(fd).isFile());
 const bytes=readSource({EXHIBITOS_TEST_HAYES_SOURCE_FD:String(fd)});assert.equal(bytes.length,8383096);bytes.fill(0);assert.throws(()=>fstatSync(fd));
 const dir=mkdtempSync(join(tmpdir(),'hayes-probe-'));try{const path=join(dir,'short');writeFileSync(path,'short');const short=openSync(path,'r');assert.throws(()=>readSource({EXHIBITOS_TEST_HAYES_SOURCE_FD:String(short)}));assert.throws(()=>fstatSync(short));}finally{rmSync(dir,{recursive:true,force:true});}
});
