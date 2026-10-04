// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {verifySourceConfiguration} from './service-backup.js';
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const data=Buffer.from('synthetic private signing configuration'),seen:Uint8Array[]=[];
 const manifest={schemaVersion:'1.0.0-draft.1',kind:'service-backup',id:'bcf0ef6a-2758-4b2c-b950-05ae6f6f062b',createdAt:'2026-01-01T00:00:00Z',sourceIdentity:{systemIdentifier:'1',databaseOid:'2',database:'synthetic'},inventory:{schemaVersion:'1.0.0-draft.1',schemaDigest:hash('schema'),migrations:[{name:'001.sql',sha256:hash('migration')}],tables:[],objects:[],references:[],issues:[]},files:[{role:'database',path:'files/00000000.gcm',bytes:1,cipherBytes:37,sha256:hash('d'),cipherSha256:hash('cipher')},{role:'configuration',name:'freeze-signing-key.json',path:'files/00000001.gcm',bytes:data.length,cipherBytes:data.length+36,sha256:hash(data),cipherSha256:hash('cipher config')}]};
 const manifestBytes=Buffer.from(JSON.stringify(manifest));
 const configuration=new Map([['freeze-signing-key.json',async()=>{const b=Buffer.from(data);seen.push(b);return b;}] ]);
 return {data,seen,manifest,options:{manifestBytes,expectedManifestSha256:hash(manifestBytes),configuration}};
}
test('complete configuration is read twice, erased and reported without values or readiness flags',async()=>{
 const f=fixture(),v=await verifySourceConfiguration(f.options);expect(f.seen).toHaveLength(2);expect(f.seen.every(b=>b.every(n=>n===0))).toBe(true);expect(v.configurationFilesVerified).toBe(true);expect(v.currentInventoryVerified).toBe(false);expect(v.preflightVerified).toBe(false);expect(v.updateExecuted).toBe(false);expect(JSON.stringify(v)).not.toContain(f.data.toString());
});
test.each(['missing','extra','wrong-name','empty-manifest','oversize','duplicate'])('invalid complete configuration scope %s refuses before readers',async kind=>{
 const f=fixture();
 if(kind==='missing')f.options.configuration.clear();
 if(kind==='extra')f.options.configuration.set('unexpected',async()=>Buffer.from('x'));
 if(kind==='wrong-name'){const reader=f.options.configuration.get('freeze-signing-key.json')!;f.options.configuration.clear();f.options.configuration.set('wrong',reader);}
 if(kind==='empty-manifest')f.manifest.files.pop();
 if(kind==='oversize'){f.manifest.files[1]!.bytes=1048577;f.manifest.files[1]!.cipherBytes=1048613;}
 if(kind==='duplicate')f.manifest.files.push({...f.manifest.files[1]!,path:'files/00000002.gcm'});
 f.options.manifestBytes=Buffer.from(JSON.stringify(f.manifest));f.options.expectedManifestSha256=hash(f.options.manifestBytes);
 await expect(verifySourceConfiguration(f.options)).rejects.toThrow();expect(f.seen).toHaveLength(0);
});
test.each(['same-size','length','second-pass'])('changed configuration %s refuses and erases read buffers',async kind=>{
 const f=fixture();let pass=0;
 f.options.configuration.set('freeze-signing-key.json',async()=>{pass++;const b=Buffer.from(kind==='second-pass'&&pass===1?f.data:kind==='length'?'x':'x'.repeat(f.data.length));f.seen.push(b);return b;});
 await expect(verifySourceConfiguration(f.options)).rejects.toThrow('SOURCE_CONFIGURATION_MISMATCH');expect(f.seen.every(b=>b.every(n=>n===0))).toBe(true);
});
test('untrusted manifest hash refuses before readers; callback map changes cannot remove coverage',async()=>{
 const f=fixture();await expect(verifySourceConfiguration({...f.options,expectedManifestSha256:hash('foreign')})).rejects.toThrow('SOURCE_MANIFEST_MISMATCH');expect(f.seen).toHaveLength(0);
 const g=fixture();g.options.configuration.set('freeze-signing-key.json',async()=>{g.options.configuration.clear();const b=Buffer.from(g.data);g.seen.push(b);return b;});await verifySourceConfiguration(g.options);expect(g.seen).toHaveLength(2);
});
