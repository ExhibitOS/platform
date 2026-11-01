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

it('binds portable resource formats only to exact qualified artifacts',()=>{
 for(const oex of ['1.0.0-draft.2','1.0.0-draft.4','1.0.0-draft.5']){const m=manifest();m.formats.specPackage='0.1.0-draft.7';m.formats.specSha256='29bb5b084788d13e57cc52541585b0bb8da26611e9a46e297a693f9dbc674cd2';m.formats.oex=oex;expect(()=>validateFreezeManifest(m)).not.toThrow();}
 for(const oex of ['1.0.0-draft.2','1.0.0-draft.4','1.0.0-draft.5','1.0.0-draft.7']){const m=manifest();m.formats.specPackage='0.1.0-draft.9';m.formats.specSha256='dbaacc7c16d82b10992fe95ac35f0aca35d2781a65a0ee1a1af69dae1f838d5a';m.formats.oex=oex;expect(()=>validateFreezeManifest(m)).not.toThrow();}
 for(const oex of ['1.0.0-draft.2','1.0.0-draft.4','1.0.0-draft.5','1.0.0-draft.7','1.0.0-draft.8']){const m=manifest();m.formats.specPackage='0.1.0-draft.10';m.formats.specSha256='bd3105374589c2f6d019d425f939587ba1ba422b448874c693b71abf0c946f29';m.formats.oex=oex;expect(()=>validateFreezeManifest(m)).not.toThrow();}
 for(const oex of ['1.0.0-draft.2','1.0.0-draft.4','1.0.0-draft.5','1.0.0-draft.7','1.0.0-draft.8']){const m=manifest();m.formats.specPackage='0.1.0-draft.11';m.formats.specSha256='7b06dae895ea4ef46a0ad94958945db022b65978371d4b15c161ccdcc7498b84';m.formats.oex=oex;expect(()=>validateFreezeManifest(m)).not.toThrow();}
 const large=manifest();large.formats.specPackage='0.1.0-draft.11';large.formats.specSha256='7b06dae895ea4ef46a0ad94958945db022b65978371d4b15c161ccdcc7498b84';large.formats.oex='1.0.0-draft.9';expect(()=>validateFreezeManifest(large)).toThrow('FREEZE_FORMAT_UNSUPPORTED');
 const old=manifest();old.formats.specPackage='0.1.0-draft.9';old.formats.specSha256='dbaacc7c16d82b10992fe95ac35f0aca35d2781a65a0ee1a1af69dae1f838d5a';old.formats.oex='1.0.0-draft.8';expect(()=>validateFreezeManifest(old)).toThrow('FREEZE_FORMAT_UNSUPPORTED');
 for(const patch of [{specSha256:hash},{oex:'1.0.0-draft.6'},{oex:['1.0.0-draft.7']}]){const m=manifest();Object.assign(m.formats,{specPackage:'0.1.0-draft.9',specSha256:'dbaacc7c16d82b10992fe95ac35f0aca35d2781a65a0ee1a1af69dae1f838d5a',oex:'1.0.0-draft.7'},patch);expect(()=>validateFreezeManifest(m)).toThrow('FREEZE_FORMAT_UNSUPPORTED');}
 for(const patch of [{specPackage:'0.1.0-draft.7',specSha256:'29bb5b084788d13e57cc52541585b0bb8da26611e9a46e297a693f9dbc674cd2',oex:['1.0.0-draft.5']},{oex:'1.0.0-draft.5'},{specPackage:'0.1.0-draft.7',specSha256:hash,oex:'1.0.0-draft.5'},{specPackage:'0.1.0-draft.7',specSha256:'29bb5b084788d13e57cc52541585b0bb8da26611e9a46e297a693f9dbc674cd2',oex:'1.0.0-draft.99'}]){const m=manifest();Object.assign(m.formats,patch);expect(()=>validateFreezeManifest(m)).toThrow('FREEZE_FORMAT_UNSUPPORTED');}
});
