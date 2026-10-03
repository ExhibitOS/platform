import {describe,it,expect} from 'vitest';
import {validateFreezeManifest} from './freeze-bundle.js';
import {freezeFileMime,type FreezeManifest} from './freeze.js';

const id='11111111-1111-4111-8111-111111111111',hash='0'.repeat(64);
function manifest():FreezeManifest{return {
 schemaVersion:'1.0.0-draft.1',kind:'exhibition-freeze',id,createdAt:'2026-10-02T00:00:00.000Z',
 source:{exhibitionId:id,revision:1,etag:`"studio-r1-${hash}"`,exhibitionHash:hash},
 formats:{oes:'1.0.0-draft.1',oex:'1.0.0-draft.2',specPackage:'0.1.0-draft.2',specSha256:'164525a8cbcf4f81dbf16d119fdf37f614aaaa9bbc9c362f2723348753bea154',migrations:[`010_freeze.sql:${hash}`]},
 oex:{bytes:1,sha256:hash},runtime:{version:'0.1.0',coreDigest:hash,imageDigest:hash,files:['THIRD_PARTY_NOTICES.txt','assets/test.js','freeze-runtime.json','index.html','offline-server.mjs','studio-sw.js'].map(path=>({path,bytes:1,sha256:hash,mime:freezeFileMime(path)!}))},
 authority:{origin:'http://127.0.0.1:3000',keyId:hash,publicKey:'test'}
};}
describe('closed freeze runtime inventory',()=>{
 it('rejects unsupported and traversing paths even when null MIME matches an unknown lookup',()=>{
  for(const path of ['../private-key.json','assets/../../secret.js','other.txt','/index.html']){
   const value:unknown=manifest();const mutated=value as {runtime:{files:unknown[]}};
   mutated.runtime.files.push({path,bytes:1,sha256:hash,mime:null});
   expect(()=>validateFreezeManifest(value)).toThrow('FREEZE_RUNTIME_INVALID');
  }
 });
 it('accepts only declared public runtime file types',()=>{
  const value=manifest();expect(()=>validateFreezeManifest(value)).not.toThrow();
  value.runtime.files[0]!.mime='application/octet-stream';
  expect(()=>validateFreezeManifest(value)).toThrow('FREEZE_RUNTIME_INVALID');
 });
});

describe('freeze Spec provenance compatibility',()=>{
 it('accepts old and current exact immutable artifact pairs',()=>{
  const old=manifest();expect(()=>validateFreezeManifest(old)).not.toThrow();
  const current=manifest();current.formats.specPackage='0.1.0-draft.3';current.formats.specSha256='22c4bc6a931f2c705d0ed2803f51a53b40a575e11c03b7a934be97edba13e5a8';expect(()=>validateFreezeManifest(current)).not.toThrow();
 });
 it('rejects swapped version/hash pairs, unknown and malformed provenance',()=>{
  for(const [version,digest] of [['0.1.0-draft.3','164525a8cbcf4f81dbf16d119fdf37f614aaaa9bbc9c362f2723348753bea154'],['0.1.0-draft.2','22c4bc6a931f2c705d0ed2803f51a53b40a575e11c03b7a934be97edba13e5a8'],['0.1.0-draft.4',hash],['0.1.0-draft.3',hash],['0.1.0-draft.3','invalid']]){
   const value=manifest();value.formats.specPackage=version!;value.formats.specSha256=digest!;expect(()=>validateFreezeManifest(value)).toThrow('FREEZE_FORMAT_UNSUPPORTED');
  }
 });
});
