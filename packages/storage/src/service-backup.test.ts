// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect,vi} from 'vitest';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,access,rename,stat,chmod,symlink,link,realpath,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {FileBlobStore} from './blobs.js';
import {createServiceBackup,verifyServiceBackup,restoreServiceBackup} from './service-backup.js';
import * as encryptedFiles from './encrypted-files.js';
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
test.skipIf(typeof process.getuid!=='function').each([0,6148,1048576])('bounded Finder metadata (%i bytes) stays outside authenticated and restored content',async(bytes)=>{
 const f=await deploymentFixture();await createServiceBackup(f.options);
 const path=join(f.options.destination,'.DS_Store'),metadata=Buffer.alloc(bytes,0x53);await writeFile(path,metadata,{mode:0o644,flag:'wx'});await chmod(path,0o644);
 const verified=await verifyServiceBackup({source:f.options.destination,encryptionKey:f.options.encryptionKey,destination:join(f.root,'finder-verify')});
 expect(verified.files).toHaveLength(1);expect(verified.manifest.files.map(file=>file.path)).toEqual(['files/00000000.gcm']);expect(verified.receipt.objectCount).toBe(0);
 await restoreServiceBackup({pool:f.makePool('789'),store:f.store,source:f.options.destination,encryptionKey:f.options.encryptionKey,destination:join(f.root,'finder-restore'),snapshot:async()=>f.inventory,restore:async()=>{}});
 await expect(access(join(f.root,'finder-restore','.DS_Store'))).rejects.toThrow();expect(await readFile(path)).toEqual(metadata);expect((await stat(path)).mode&0o777).toBe(0o644);
});
test.skipIf(typeof process.getuid!=='function').each(['unknown','unknown-with-finder','nested','symlink','hardlink','directory','fifo','oversized','executable','writable','special'])('Finder exception rejects %s archive entries',async(kind)=>{
 const f=await deploymentFixture();await createServiceBackup(f.options);const path=join(f.options.destination,'.DS_Store');
 if(kind==='unknown'||kind==='unknown-with-finder')await writeFile(join(f.options.destination,'.unexpected'),Buffer.from('unknown'),{mode:0o600});
 if(kind==='nested')await writeFile(join(f.options.destination,'files/.DS_Store'),Buffer.from('nested'),{mode:0o600});
 if(kind==='symlink')await symlink('manifest.gcm',path);
 else if(kind==='hardlink')await link(join(f.options.destination,'manifest.gcm'),path);
 else if(kind==='directory')await mkdir(path,{mode:0o700});
 else if(kind==='fifo')await promisify(execFile)('mkfifo',[path]);
 else if(!['unknown','nested'].includes(kind)){
  await writeFile(path,Buffer.alloc(kind==='oversized'?1048577:6148,0x53),{mode:0o644,flag:'wx'});
  await chmod(path,kind==='executable'?0o744:kind==='writable'?0o664:kind==='special'?0o1644:0o644);
 }
 await expect(verifyServiceBackup({source:f.options.destination,encryptionKey:f.options.encryptionKey,destination:join(f.root,'finder-refused')})).rejects.toThrow('BACKUP_VERIFY_FAILED');
});
test.skipIf(typeof process.getuid!=='function').each(['add','remove','replace','mutate','mode','unknown'])('Finder metadata %s during decryption refuses verification completion',async(kind)=>{
 const f=await deploymentFixture();await createServiceBackup(f.options);const path=join(f.options.destination,'.DS_Store');
 if(kind!=='add')await writeFile(path,Buffer.alloc(6148,0x53),{mode:0o644,flag:'wx'});
 const decrypt=encryptedFiles.decryptBackupFile;
 const spy=vi.spyOn(encryptedFiles,'decryptBackupFile').mockImplementationOnce(async(...args)=>{
  const result=await decrypt(...args);
  if(kind==='remove')await unlink(path);
  else if(kind==='replace'){await rename(path,join(f.root,'preserved-finder-metadata'));await writeFile(path,Buffer.alloc(6148,0x53),{mode:0o644,flag:'wx'});}
  else if(kind==='mode')await chmod(path,0o600);
  else if(kind==='unknown')await writeFile(join(f.options.destination,'.unexpected'),Buffer.from('unknown'),{mode:0o600});
  else await writeFile(path,Buffer.alloc(6148,kind==='add'?0x53:0x54),{mode:0o644,flag:kind==='add'?'wx':'w'});
  return result;
 });
 const destination=join(f.root,'finder-churn');
 try{
  await expect(verifyServiceBackup({source:f.options.destination,encryptionKey:f.options.encryptionKey,destination})).rejects.toThrow('BACKUP_VERIFY_FAILED');expect(spy).toHaveBeenCalled();
  expect(JSON.parse(await readFile(join(destination,'failed.json'),'utf8'))).toEqual({status:'failed',phase:'archive-final'});
  expect((await stat(join(destination,'failed.json'))).mode&0o777).toBe(0o600);
  const manifest=JSON.parse(await readFile(join(destination,'manifest.json'),'utf8'));
  for(const file of manifest.files){
   const bytes=await readFile(join(destination,file.path.slice(6)+'.plain'));
   expect(bytes.length).toBe(file.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
  }
  await access(join(f.options.destination,'complete.json'));
 }
 finally{spy.mockRestore();}
});
test.skipIf(typeof process.getuid!=='function')('Finder metadata does not bypass wrong-key or ciphertext authentication',async()=>{
 const f=await deploymentFixture();await createServiceBackup(f.options);const path=join(f.options.destination,'.DS_Store');await writeFile(path,Buffer.alloc(6148,0x53),{mode:0o644,flag:'wx'});
 await expect(verifyServiceBackup({source:f.options.destination,encryptionKey:randomBytes(32),destination:join(f.root,'finder-wrong-key')})).rejects.toThrow('BACKUP_VERIFY_FAILED');
 expect(JSON.parse(await readFile(join(f.root,'finder-wrong-key/failed.json'),'utf8'))).toEqual({status:'failed',phase:'manifest-decrypt'});
 const cipher=join(f.options.destination,'files/00000000.gcm'),bytes=await readFile(cipher);bytes[bytes.length-1]=bytes[bytes.length-1]!^1;await writeFile(cipher,bytes);
 await expect(verifyServiceBackup({source:f.options.destination,encryptionKey:f.options.encryptionKey,destination:join(f.root,'finder-corruption')})).rejects.toThrow('BACKUP_VERIFY_FAILED');
 expect(JSON.parse(await readFile(join(f.root,'finder-corruption/failed.json'),'utf8'))).toEqual({status:'failed',phase:'files-decrypt'});
 expect(await readFile(path)).toEqual(Buffer.alloc(6148,0x53));
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

test('exact historical restore supplies only authenticated immutable migration expectations to its snapshot',async()=>{
 const f=await deploymentFixture();await createServiceBackup(f.options);
 let snapshots=0;
 await restoreServiceBackup({pool:f.makePool('789'),store:f.store,source:f.options.destination,encryptionKey:f.options.encryptionKey,destination:join(f.root,'historical-restore'),restore:async()=>{},snapshot:async(_client,catalog)=>{
  snapshots++;expect(catalog).toEqual(f.inventory.migrations);
  expect(Object.isFrozen(catalog)).toBe(true);expect(Object.isFrozen(catalog![0])).toBe(true);
  expect(()=>{catalog![0]!.sha256=hash('changed expectation');}).toThrow();
  return structuredClone(f.inventory);
 }});
 expect(snapshots).toBe(1);
 await expect(restoreServiceBackup({pool:f.makePool('789'),store:f.store,source:f.options.destination,encryptionKey:randomBytes(32),destination:join(f.root,'wrong-key-history'),restore:async()=>{throw Error('must not restore');},snapshot:async()=>{snapshots++;return f.inventory;}})).rejects.toThrow('BACKUP_VERIFY_FAILED');
 expect(snapshots).toBe(1);
});
