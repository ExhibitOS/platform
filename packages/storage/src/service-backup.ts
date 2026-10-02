// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,mkdtemp,rm,lstat,realpath,readdir,readFile,writeFile,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from './blobs.js';
import {inventoryCanonical,type ServiceInventory} from './service-inventory.js';
import {encryptBackupFile,decryptBackupFile,hashBackupFile,type EncryptedFile} from './encrypted-files.js';
export interface BackupFile extends EncryptedFile {role:'database'|'object'|'runtime'|'configuration';path:string;key?:string;name?:string}
export interface BackupManifest {schemaVersion:'1.0.0-draft.1';kind:'service-backup';id:string;createdAt:string;sourceIdentity:{systemIdentifier:string;databaseOid:string;database:string};inventory:ServiceInventory;runtimeMetadata?:unknown;files:BackupFile[]}
export interface BackupReceipt {id:string;status:'complete';manifestSha256:string;objectCount:number}
type Snapshot=(client:PoolClient)=>Promise<ServiceInventory>;
const sha=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const objectKey=(v:unknown):v is string=>typeof v==='string'&&v.length<=1024&&/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(v)&&!v.split('/').some(p=>p==='.'||p==='..');
const nameValid=(v:unknown):v is string=>typeof v==='string'&&v.length<=1024&&/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(v)&&!v.split('/').some(p=>p==='.'||p==='..'||p==='');
async function privateDirectory(path:string,create:boolean){
 const target=resolve(path);if(create)await mkdir(target,{mode:0o700});
 const stat=await lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw Error('BACKUP_DIRECTORY_INVALID');
 return await realpath(target);
}
async function secretRead(path:string,max=16*1024*1024){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>max||(stat.mode&0o077)!==0)throw Error('BACKUP_FILE_INVALID');return await file.readFile();}finally{await file.close();}}
async function jsonExclusive(path:string,value:unknown){const file=await open(path,'wx',0o600);try{await file.writeFile(inventoryCanonical(value)+'\n');await file.sync();}finally{await file.close();}}
async function supportedDatabase(c:PoolClient){const custom=(await c.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%'")).rows;if(custom.length)throw Error('BACKUP_UNSUPPORTED_SCHEMA');}
async function identity(c:PoolClient):Promise<BackupManifest['sourceIdentity']>{
 const row=(await c.query("SELECT system_identifier::text AS system, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid, current_database() AS database FROM pg_control_system()")).rows[0];
 if(!row||!/^\d+$/.test(row.system)||!/^\d+$/.test(row.oid)||typeof row.database!=='string')throw Error('BACKUP_SOURCE_IDENTITY');return {systemIdentifier:row.system,databaseOid:row.oid,database:row.database};
}
function comparable(inventory:ServiceInventory){const {createdAt:_createdAt,...rest}=inventory;void _createdAt;return inventoryCanonical(rest);}
function validateInventory(v:ServiceInventory){
 if(!v||v.schemaVersion!=='1.0.0-draft.1'||!hex(v.schemaDigest)||!Array.isArray(v.migrations)||!v.migrations.length||!Array.isArray(v.tables)||!Array.isArray(v.objects)||!Array.isArray(v.references)||!Array.isArray(v.issues)||v.issues.length)throw Error('BACKUP_INVENTORY_INVALID');
 if(v.migrations.some(m=>typeof m.name!=='string'||!hex(m.sha256))||v.tables.some(t=>typeof t.name!=='string'||!Number.isSafeInteger(t.rowCount)||t.rowCount<0||!hex(t.sha256))||v.objects.some(o=>!objectKey(o.key)||!Number.isSafeInteger(o.bytes)||o.bytes<1||o.bytes>32*1024*1024||!hex(o.sha256)))throw Error('BACKUP_INVENTORY_INVALID');
 if(new Set(v.objects.map(o=>o.key)).size!==v.objects.length)throw Error('BACKUP_INVENTORY_INVALID');
}
function validateManifest(m:BackupManifest){
 if(!m||m.schemaVersion!=='1.0.0-draft.1'||m.kind!=='service-backup'||typeof m.id!=='string'||!/^[-a-f0-9]{36}$/.test(m.id)||typeof m.createdAt!=='string'||!Number.isFinite(Date.parse(m.createdAt))||!m.sourceIdentity||!/^\d+$/.test(m.sourceIdentity.systemIdentifier)||!/^\d+$/.test(m.sourceIdentity.databaseOid)||typeof m.sourceIdentity.database!=='string'||!Array.isArray(m.files)||m.files.length>100000)throw Error('BACKUP_MANIFEST_INVALID');
 validateInventory(m.inventory);const paths=new Set<string>(),keys=new Set<string>(),names=new Set<string>();let databases=0;
 for(const f of m.files){
  if(!f||!['database','object','runtime','configuration'].includes(f.role)||typeof f.path!=='string'||!/^files\/[0-9]{8}\.gcm$/.test(f.path)||paths.has(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<1||!Number.isSafeInteger(f.cipherBytes)||f.cipherBytes!==f.bytes+36||!hex(f.sha256)||!hex(f.cipherSha256))throw Error('BACKUP_MANIFEST_INVALID');paths.add(f.path);
  if(f.role==='database'){databases++;if(f.key!==undefined||f.name!==undefined)throw Error('BACKUP_MANIFEST_INVALID');}
  else if(f.role==='object'){if(!objectKey(f.key)||f.name!==undefined||keys.has(f.key))throw Error('BACKUP_MANIFEST_INVALID');keys.add(f.key);const o=m.inventory.objects.find(o=>o.key===f.key);if(!o||o.bytes!==f.bytes||o.sha256!==f.sha256)throw Error('BACKUP_MANIFEST_INVALID');}
  else {if(!nameValid(f.name)||f.key!==undefined||names.has(f.role+':'+f.name))throw Error('BACKUP_MANIFEST_INVALID');names.add(f.role+':'+f.name);}
 }
 if(databases!==1||keys.size!==m.inventory.objects.length)throw Error('BACKUP_MANIFEST_INVALID');
}
/** Operator only: contains all tenants, account hashes and signing configuration. */
export async function createServiceBackup(options:{pool:Pool;store:BlobStore;destination:string;encryptionKey:Uint8Array;snapshot:Snapshot;dump:(path:string,snapshotId:string)=>Promise<void>;runtime?:{metadata:unknown;files:Map<string,Uint8Array>};configuration?:Map<string,Uint8Array>}):Promise<BackupReceipt>{
 if(options.encryptionKey.length!==32||!options.store.listAll)throw Error('BACKUP_CONFIG');
 const directory=await privateDirectory(options.destination,true),id=randomUUID(),createdAt=new Date().toISOString();
 await jsonExclusive(join(directory,'writing.json'),{id,status:'writing',createdAt});await mkdir(join(directory,'files'),{mode:0o700});const scratch=await mkdtemp(join(tmpdir(),'exhibitos-backup-private-'));
 const c=await options.pool.connect();let locked=false,transaction=false;
 try{
  // The lock precedes BEGIN: a waiting backup must not export an older snapshot.
  await c.query('SELECT pg_advisory_lock(82002)');locked=true;await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');transaction=true;
  await supportedDatabase(c);const sourceIdentity=await identity(c),inventory=await options.snapshot(c);validateInventory(inventory);
  const snapshotId=(await c.query('SELECT pg_export_snapshot() AS id')).rows[0]?.id;if(typeof snapshotId!=='string'||!/^[-a-fA-F0-9]+$/.test(snapshotId))throw Error('BACKUP_SNAPSHOT');
  const manifest:BackupManifest={schemaVersion:'1.0.0-draft.1',kind:'service-backup',id,createdAt,sourceIdentity,inventory,...(options.runtime?{runtimeMetadata:options.runtime.metadata}:{}),files:[]};
  const append=async(role:BackupFile['role'],plain:string,extra:{key?:string;name?:string}={})=>{const path=`files/${String(manifest.files.length).padStart(8,'0')}.gcm`;const hashes=await encryptBackupFile(plain,join(directory,path),options.encryptionKey,id+':'+path);manifest.files.push({role,path,...extra,...hashes});};
  const dump=join(scratch,'database.dump');await options.dump(dump,snapshotId);await append('database',dump);
  for(const o of inventory.objects){const data=await options.store.get(o.key);if(data.length!==o.bytes||sha(data)!==o.sha256)throw Error('BACKUP_SOURCE_CHANGED');const plain=join(scratch,`object-${manifest.files.length}`);await writeFile(plain,data,{mode:0o600,flag:'wx'});await append('object',plain,{key:o.key});}
  for(const [role,files]of [['runtime',options.runtime?.files],['configuration',options.configuration]] as const){if(!files)continue;for(const [name,data]of files){if(!nameValid(name)||!data.length)throw Error('BACKUP_CONFIG');const plain=join(scratch,`extra-${manifest.files.length}`);await writeFile(plain,data,{mode:0o600,flag:'wx'});await append(role,plain,{name});}}
  // Recheck the entire DB/object inventory before publishing a complete receipt.
  if(comparable(await options.snapshot(c))!==comparable(inventory))throw Error('BACKUP_SOURCE_CHANGED');
  validateManifest(manifest);if(Buffer.byteLength(inventoryCanonical(manifest)+'\n')>16*1024*1024)throw Error('BACKUP_MANIFEST_LIMIT');const plainManifest=join(scratch,'manifest.json');await jsonExclusive(plainManifest,manifest);
  const encrypted=await encryptBackupFile(plainManifest,join(directory,'manifest.gcm'),options.encryptionKey,id+':manifest');
  await c.query('COMMIT');transaction=false;
  const receipt:BackupReceipt={id,status:'complete',manifestSha256:encrypted.cipherSha256,objectCount:inventory.objects.length};await jsonExclusive(join(directory,'complete.json'),receipt);return receipt;
 }catch{await jsonExclusive(join(directory,'failed.json'),{id,status:'failed'}).catch(()=>{});throw Error('BACKUP_FAILED');}
 finally{let broken=false;if(transaction)await c.query('ROLLBACK').catch(()=>{broken=true;});if(locked)await c.query('SELECT pg_advisory_unlock(82002)').catch(()=>{broken=true;});c.release(broken);await rm(scratch,{recursive:true,force:true});}
}
export async function verifyServiceBackup(options:{source:string;encryptionKey:Uint8Array;destination:string}):Promise<{manifest:BackupManifest;files:(BackupFile&{plainPath:string})[];receipt:BackupReceipt}>{
 const source=await privateDirectory(options.source,false),destination=await privateDirectory(options.destination,true);
 try{
  const receipt=JSON.parse((await secretRead(join(source,'complete.json'),4096)).toString()) as BackupReceipt;
  if(receipt.status!=='complete'||typeof receipt.id!=='string'||!/^[-a-f0-9]{36}$/.test(receipt.id)||!hex(receipt.manifestSha256)||!Number.isSafeInteger(receipt.objectCount)||receipt.objectCount<0)throw Error('BACKUP_RECEIPT_INVALID');
  const contents=(await readdir(source)).sort();if(inventoryCanonical(contents)!==inventoryCanonical(['complete.json','files','manifest.gcm','writing.json']))throw Error('BACKUP_ARCHIVE_INVENTORY');
  if((await hashBackupFile(join(source,'manifest.gcm'))).sha256!==receipt.manifestSha256)throw Error('BACKUP_MANIFEST_INTEGRITY');
  await decryptBackupFile(join(source,'manifest.gcm'),join(destination,'manifest.json'),options.encryptionKey,receipt.id+':manifest');
  const manifest=JSON.parse((await secretRead(join(destination,'manifest.json'))).toString()) as BackupManifest;validateManifest(manifest);
  if(manifest.id!==receipt.id||manifest.inventory.objects.length!==receipt.objectCount)throw Error('BACKUP_RECEIPT_INVALID');
  const fileDirectory=await privateDirectory(join(source,'files'),false),actual=(await readdir(fileDirectory)).sort(),expected=manifest.files.map(f=>f.path.slice(6)).sort();if(inventoryCanonical(actual)!==inventoryCanonical(expected))throw Error('BACKUP_FILE_INVENTORY');
  const files=[];for(const f of manifest.files){const plainPath=join(destination,f.path.slice(6)+'.plain');await decryptBackupFile(join(fileDirectory,f.path.slice(6)),plainPath,options.encryptionKey,manifest.id+':'+f.path,f);files.push({...f,plainPath});}
  return {manifest,files,receipt};
 }catch{await jsonExclusive(join(destination,'failed.json'),{status:'failed'}).catch(()=>{});throw Error('BACKUP_VERIFY_FAILED');}
}
/** Fresh isolated target only. A failed candidate is left for inspection, never activated. */
export async function restoreServiceBackup(options:{pool:Pool;store:BlobStore;source:string;encryptionKey:Uint8Array;destination:string;snapshot:Snapshot;restore:(path:string)=>Promise<void>}):Promise<BackupReceipt&{inventory:ServiceInventory}>{
 if(!options.store.listAll)throw Error('RESTORE_CONFIG');
 const verified=await verifyServiceBackup(options);const c=await options.pool.connect();let locked=false,transaction=false;
 try{
  await c.query('SELECT pg_advisory_lock(82002)');locked=true;
  await supportedDatabase(c);
  const target=await identity(c),source=verified.manifest.sourceIdentity;
  if(target.systemIdentifier===source.systemIdentifier&&target.databaseOid===source.databaseOid)throw Error('RESTORE_ORIGINAL_DATABASE');
  const definitions=(await c.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'")).rows;
  if(definitions.length||(await options.store.listAll()).length)throw Error('RESTORE_TARGET_NOT_EMPTY');
  await options.restore(verified.files.find(f=>f.role==='database')!.plainPath);
  for(const f of verified.files.filter(f=>f.role==='object')){await options.store.put(f.key!,await readFile(f.plainPath));}
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');transaction=true;
  const inventory=await options.snapshot(c);validateInventory(inventory);if(comparable(inventory)!==comparable(verified.manifest.inventory))throw Error('RESTORE_INVENTORY_MISMATCH');
  await c.query('COMMIT');transaction=false;
  // Reconstitute named configuration/runtime only after DB/object equality passes.
  // These are staged files in the new private candidate, never the running source.
  for(const role of ['runtime','configuration'] as const){const entries=verified.files.filter(f=>f.role===role);if(!entries.length)continue;const root=join(resolve(options.destination),role);await mkdir(root,{mode:0o700});for(const f of entries){let directory=root;const parts=f.name!.split('/');for(const part of parts.slice(0,-1)){directory=join(directory,part);await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('RESTORE_PATH_INVALID');}await writeFile(join(directory,parts.at(-1)!),await readFile(f.plainPath),{mode:0o600,flag:'wx'});}}
  const receipt={...verified.receipt,inventory};await jsonExclusive(join(resolve(options.destination),'restored.json'),verified.receipt);return receipt;
 }catch{await jsonExclusive(join(resolve(options.destination),'restore-failed.json'),{status:'failed'}).catch(()=>{});throw Error('RESTORE_FAILED');}
 finally{let broken=false;if(transaction)await c.query('ROLLBACK').catch(()=>{broken=true;});if(locked)await c.query('SELECT pg_advisory_unlock(82002)').catch(()=>{broken=true;});c.release(broken);}
}
