// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,access,rename,stat,chmod,symlink,link,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {FileBlobStore} from './blobs.js';
import {createServiceBackup,verifyServiceBackup,restoreServiceBackup} from './service-backup.js';
import type {ServiceInventory} from './service-inventory.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
// DB adapter is isolated here; this test exercises actual archive encryption,
// completion publication and the reader's bounded manifest, not SQL recovery.
test('oversized inventory cannot publish a complete archive that the bounded reader cannot restore',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exhibitos-backup-limit-'));await mkdir(join(root,'objects'),{mode:0o700});const store=new FileBlobStore(join(root,'objects'));
 const data=Buffer.from('synthetic protected object');await store.put('synthetic/objects/preserved',data);
 const inventory:ServiceInventory={schemaVersion:'1.0.0-draft.1',createdAt:new Date().toISOString(),schemaDigest:hash('schema'),migrations:[{name:'001.sql',sha256:hash('migration')}],tables:[],objects:[{key:'synthetic/objects/preserved',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),referenced:false,bindings:['x'.repeat(16*1024*1024)]}],references:[],issues:[]};
 const client={async query(sql:string){return {rows:sql.includes('pg_control_system')?[{system:'123',oid:'456',database:'synthetic'}]:sql.includes('pg_export_snapshot')?[{id:'00000001-00000002-1'}]:[]};},release(){}};
 const pool={async connect(){return client;}} as unknown as Pool;
 const archive=join(root,'archive'),key=randomBytes(32);
 await expect(createServiceBackup({pool,store,destination:archive,encryptionKey:key,snapshot:async()=>inventory,dump:async path=>{await writeFile(path,'synthetic dump',{mode:0o600,flag:'wx'});}})).rejects.toThrow('BACKUP_FAILED');
 await expect(access(join(archive,'complete.json'))).rejects.toThrow();
 expect(JSON.parse(await readFile(join(archive,'failed.json'),'utf8')).status).toBe('failed');expect(await store.get('synthetic/objects/preserved')).toEqual(data);
 await expect(verifyServiceBackup({source:archive,encryptionKey:key,destination:join(root,'refused')})).rejects.toThrow('BACKUP_VERIFY_FAILED');
},10000);

// SQL is an isolated adapter; real streamed file crypto and fresh staging are
// exercised here. These cases do not qualify PostgreSQL or OCI image loading.
async function deploymentFixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-deployment-backup-')));await mkdir(join(root,'objects'),{mode:0o700});
 const store=new FileBlobStore(join(root,'objects'));
 const inventory:ServiceInventory={schemaVersion:'1.0.0-draft.1',createdAt:new Date().toISOString(),schemaDigest:hash('schema'),migrations:[{name:'001.sql',sha256:hash('migration')}],tables:[],objects:[],references:[],issues:[]};
 const makePool=(system:string)=>({async connect(){return {async query(sql:string){return {rows:sql.includes('pg_control_system')?[{system,oid:'456',database:'synthetic'}]:sql.includes('pg_export_snapshot')?[{id:'00000001-00000002-1'}]:[]};},release(){}};}} as unknown as Pool);
 const path=join(root,'image.tar'),data=Buffer.alloc(4*1024*1024,0x73);await writeFile(path,data,{mode:0o600,flag:'wx'});
 const file={path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
 const options={pool:makePool('123'),store,destination:join(root,'archive'),encryptionKey:randomBytes(32),snapshot:async()=>inventory,dump:async(path:string)=>{await writeFile(path,'synthetic dump',{mode:0o600,flag:'wx'});}};
 return {root,store,inventory,makePool,data,file,options};
}
test('draft2 streamed deployment artifact authenticates and stages after source is unavailable',async()=>{
 const f=await deploymentFixture();await createServiceBackup({...f.options,deployment:new Map([['images/platform.tar',f.file]])});
 await rename(f.file.path,join(f.root,'unavailable-original.tar'));
 const result=await verifyServiceBackup({source:f.options.destination,encryptionKey:f.options.encryptionKey,destination:join(f.root,'verify')});
 expect(result.manifest.schemaVersion).toBe('1.0.0-draft.2');expect(result.files.find(v=>v.role==='deployment')?.sha256).toBe(f.file.sha256);
 await restoreServiceBackup({pool:f.makePool('789'),store:f.store,source:f.options.destination,encryptionKey:f.options.encryptionKey,destination:join(f.root,'restore'),snapshot:async()=>f.inventory,restore:async()=>{}});
 const staged=join(f.root,'restore/deployment/images/platform.tar');expect(createHash('sha256').update(await readFile(staged)).digest('hex')).toBe(f.file.sha256);expect((await stat(staged)).mode&0o777).toBe(0o600);
 expect(createHash('sha256').update(await readFile(join(f.root,'unavailable-original.tar'))).digest('hex')).toBe(f.file.sha256);
},10000);
test('archives without deployment files keep draft1 compatibility',async()=>{
 const f=await deploymentFixture();await createServiceBackup(f.options);
 const result=await verifyServiceBackup({source:f.options.destination,encryptionKey:f.options.encryptionKey,destination:join(f.root,'verify')});expect(result.manifest.schemaVersion).toBe('1.0.0-draft.1');
});
test.each(['wrong-hash','wrong-size','oversized','public-mode','symlink','hardlink','traversal','too-many'])('deployment input %s cannot publish completion',async(kind)=>{
 const f=await deploymentFixture();let name='images/platform.tar';const file={...f.file};
 if(kind==='wrong-hash')file.sha256=hash('different image');
 if(kind==='wrong-size')file.bytes++;
 if(kind==='oversized')file.bytes=8*1024*1024*1024+1;
 if(kind==='public-mode')await chmod(file.path,0o644);
 if(kind==='symlink'){const path=join(f.root,'image-link');await symlink(file.path,path);file.path=path;}
 if(kind==='hardlink')await link(file.path,join(f.root,'image-hardlink'));
 if(kind==='traversal')name='../platform.tar';
 const deployment=new Map([[name,file]]);if(kind==='too-many')for(let n=0;n<32;n++)deployment.set(`image-${n}.tar`,file);
 await expect(createServiceBackup({...f.options,deployment})).rejects.toThrow('BACKUP_FAILED');await expect(access(join(f.options.destination,'complete.json'))).rejects.toThrow();expect(createHash('sha256').update(await readFile(f.file.path)).digest('hex')).toBe(f.file.sha256);
});
