// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Transform,Writable} from 'node:stream';
import {Pool} from 'pg';
import {S3Client} from '@aws-sdk/client-s3';
import {FileBlobStore,S3BlobStore,collectServiceInventory} from '../packages/storage/dist/index.js';

const fail=code=>{throw Error(code);};
const inside=(parent,path)=>{const rel=relative(resolve(parent),resolve(path));return rel===''||rel!== '..'&&!rel.startsWith('../')&&!rel.startsWith('..\\')&&!rel.startsWith('/');};
async function privateFile(path,max){
 const target=resolve(path);if(await realpath(target)!==target)fail('BACKUP_FILE_PATH');
 const file=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o7777)!==0o600||stat.size<1||stat.size>max)fail('BACKUP_FILE_MODE');return await file.readFile();}finally{await file.close();}
}
export async function initializeBackupKey(path){
 const target=resolve(path),parent=dirname(target),stat=await lstat(parent);
 if(await realpath(parent)!==parent||!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)fail('BACKUP_KEY_DIRECTORY');
 const file=await open(target,'wx',0o600);try{await file.writeFile(randomBytes(32));await file.sync();}finally{await file.close();}
}
export async function readBackupKey(path){const bytes=await privateFile(path,32);if(bytes.length!==32)fail('BACKUP_KEY_SIZE');return bytes;}
/** Turn a private URL into environment variables; no connection string/credentials appear in child arguments. */
export function postgresEnvironment(connectionString,environment=process.env){
 let url;try{url=new URL(connectionString);}catch{fail('BACKUP_DATABASE_CONFIG');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.hash||url.pathname.length<2)fail('BACKUP_DATABASE_CONFIG');
 const allowed=new Set(['sslmode','sslrootcert','sslcert','sslkey','application_name','connect_timeout']);
 for(const key of url.searchParams.keys())if(!allowed.has(key))fail('BACKUP_DATABASE_OPTION');
 const decode=value=>{try{return decodeURIComponent(value);}catch{fail('BACKUP_DATABASE_CONFIG');}};
 const env={...environment,PGHOST:url.hostname.replace(/^\[|\]$/g,''),PGPORT:url.port||'5432',PGUSER:decode(url.username)||environment.PGUSER,PGDATABASE:decode(url.pathname.slice(1)),PGPASSWORD:decode(url.password)||environment.PGPASSWORD,PGCONNECT_TIMEOUT:'15',PGAPPNAME:'exhibitos-service-backup'};
 for(const [name,key]of [['PGSSLMODE','sslmode'],['PGSSLROOTCERT','sslrootcert'],['PGSSLCERT','sslcert'],['PGSSLKEY','sslkey'],['PGCONNECT_TIMEOUT','connect_timeout']])if(url.searchParams.has(key))env[name]=url.searchParams.get(key);
 if(!env.PGUSER||!env.PGDATABASE||!env.PGPORT||/[\0\r\n]/.test(env.PGHOST+env.PGPORT+env.PGUSER+env.PGDATABASE))fail('BACKUP_DATABASE_CONFIG');
 return env;
}
export function postgresCommand(tool,args,connectionString,environment=process.env){
 if(!['pg_dump','pg_restore'].includes(tool))fail('BACKUP_PG_TOOL');
 const env=postgresEnvironment(connectionString,environment),container=environment.BACKUP_POSTGRES_CONTAINER;
 if(!container)return {command:environment[tool==='pg_dump'?'PG_DUMP_BIN':'PG_RESTORE_BIN']||tool,args,env};
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container))fail('BACKUP_CONTAINER');
 // The selected container contains the PostgreSQL server. Host-side forwarded ports are not used internally.
 env.PGHOST=environment.BACKUP_CONTAINER_PGHOST||'127.0.0.1';env.PGPORT=environment.BACKUP_CONTAINER_PGPORT||'5432';
 const names=['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGCONNECT_TIMEOUT','PGAPPNAME','PGSSLMODE','PGSSLROOTCERT','PGSSLCERT','PGSSLKEY'].filter(name=>env[name]!==undefined);
 return {command:environment.DOCKER_BIN||'docker',args:['exec','-i',...names.flatMap(name=>['-e',name]),container,tool,...args],env};
}
function launch(command,abortSignal){
 const timeout=Number(command.env.BACKUP_PG_TIMEOUT_MS??3600000);if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>86400000)fail('BACKUP_PG_TIMEOUT');
 const child=spawn(command.command,command.args,{env:command.env,stdio:['pipe','pipe','pipe'],signal:abortSignal});child.stderr.resume();
 const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);timer.unref();
 const completed=new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('BACKUP_PG_EXEC_FAILED')));child.once('close',(code,signal)=>{clearTimeout(timer);if(code===0&&!signal)resolve();else reject(Error('BACKUP_PG_EXIT_FAILED'));});});
 return {child,completed};
}
function fileSink(file){
 let position=0;
 return new Writable({write(chunk,_encoding,done){void(async()=>{let offset=0;while(offset<chunk.length){const result=await file.write(chunk,offset,chunk.length-offset,position);if(result.bytesWritten<1)fail('BACKUP_PG_WRITE_FAILED');offset+=result.bytesWritten;position+=result.bytesWritten;}})().then(()=>done(),done);}});
}
export function postgresAdapter(connectionString,environment=process.env,abortSignal){
 return {
  async dump(path,snapshotId){
   if(!/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/i.test(snapshotId))fail('BACKUP_SNAPSHOT_ID');
   const limit=Number(environment.BACKUP_MAX_DUMP_BYTES??32*1024*1024*1024);if(!Number.isSafeInteger(limit)||limit<1)fail('BACKUP_DUMP_LIMIT');
   const command=postgresCommand('pg_dump',['--format=custom','--snapshot='+snapshotId],connectionString,environment),file=await open(path,'wx',0o600);let running,size=0;
   const bound=new Transform({transform(chunk,_encoding,done){size+=chunk.length;if(size>limit)done(Error('BACKUP_DUMP_LIMIT'));else done(null,chunk);}});
   try{running=launch(command,abortSignal);running.child.stdin.end();const copying=pipeline(running.child.stdout,bound,fileSink(file)).catch(()=>{running.child.kill('SIGTERM');throw Error('BACKUP_PG_DUMP_FAILED');});await Promise.all([running.completed,copying]);if(!size)fail('BACKUP_PG_DUMP_EMPTY');await file.sync();}finally{running?.child.kill('SIGTERM');await file.close();}
  },
  async restore(path){
   // A credential-free libpq connection string activates PGDATABASE and the other private environment defaults.
   const command=postgresCommand('pg_restore',['--exit-on-error','--single-transaction','--dbname=application_name=exhibitos-service-backup'],connectionString,environment),file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let running;
   try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size<1)fail('BACKUP_DUMP_INVALID');running=launch(command,abortSignal);running.child.stdout.resume();const copying=pipeline(file.createReadStream({autoClose:true}),running.child.stdin).catch(()=>{running.child.kill('SIGTERM');throw Error('BACKUP_PG_RESTORE_FAILED');});await Promise.all([running.completed,copying]);}finally{running?.child.kill('SIGTERM');await file.close().catch(()=>{});}
  },
 };
}

function parse(argv){
 const [command,...args]=argv,flags={};if(!['key-init','create','verify','restore'].includes(command))fail('BACKUP_USAGE');
 for(let i=0;i<args.length;i++){const key=args[i];if(!['--key-file','--destination','--source','--quiesced','--fresh-destination'].includes(key)||Object.hasOwn(flags,key))fail('BACKUP_USAGE');if(['--quiesced','--fresh-destination'].includes(key))flags[key]=true;else{const value=args[++i];if(!value||value.startsWith('--'))fail('BACKUP_USAGE');flags[key]=value;}}
 if(!flags['--key-file'])fail('BACKUP_KEY_REQUIRED');return {command,flags};
}
async function storeFor(environment){
 const backend=environment.BACKUP_BLOB_BACKEND||'filesystem';
 if(backend==='filesystem'){if(!environment.BLOB_ROOT)fail('BACKUP_BLOB_ROOT_REQUIRED');if(await realpath(resolve(environment.BLOB_ROOT))!==resolve(environment.BLOB_ROOT))fail('BACKUP_BLOB_ROOT_PATH');return {store:new FileBlobStore(environment.BLOB_ROOT),dispose(){}};}
 if(backend!=='s3'||!environment.S3_BUCKET||!environment.AWS_ACCESS_KEY_ID||!environment.AWS_SECRET_ACCESS_KEY)fail('BACKUP_S3_CONFIG');
 const client=new S3Client({region:environment.AWS_REGION||'us-east-1',...(environment.S3_ENDPOINT?{endpoint:environment.S3_ENDPOINT}:{}),forcePathStyle:environment.S3_FORCE_PATH_STYLE==='1',credentials:{accessKeyId:environment.AWS_ACCESS_KEY_ID,secretAccessKey:environment.AWS_SECRET_ACCESS_KEY,...(environment.AWS_SESSION_TOKEN?{sessionToken:environment.AWS_SESSION_TOKEN}:{})}});
 return {store:new S3BlobStore(client,environment.S3_BUCKET),dispose(){client.destroy();}};
}
async function configurationFiles(environment,keyPath){
 if(!environment.BACKUP_CONFIGURATION_FILES)return undefined;let input;try{input=JSON.parse(environment.BACKUP_CONFIGURATION_FILES);}catch{fail('BACKUP_CONFIGURATION_INVALID');}
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>32)fail('BACKUP_CONFIGURATION_INVALID');const files=new Map();
 for(const[name,path]of Object.entries(input)){if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)||typeof path!=='string'||resolve(path)===resolve(keyPath))fail('BACKUP_CONFIGURATION_INVALID');files.set(name,await privateFile(path,1024*1024));}
 return files;
}
export async function main(argv=process.argv.slice(2),environment=process.env){
 const {command,flags}=parse(argv),keyPath=flags['--key-file'];
 if(command==='key-init'){if(Object.keys(flags).length!==1)fail('BACKUP_USAGE');await initializeBackupKey(keyPath);return {operation:'key-initialized'};}
 let destination=flags['--destination'],source=flags['--source'];if(!destination||command!=='create'&&!source||command==='create'&&source)fail('BACKUP_USAGE');
 destination=resolve(destination);if(await realpath(dirname(destination))!==dirname(destination))fail('BACKUP_DIRECTORY_PATH');if(source){source=resolve(source);if(await realpath(source)!==source)fail('BACKUP_DIRECTORY_PATH');}
 if(command==='create'&&flags['--fresh-destination'])fail('BACKUP_USAGE');
 if(inside(destination,keyPath)||source&&inside(source,keyPath)||source&&inside(source,destination)||source&&inside(destination,source))fail('BACKUP_PATH_OVERLAP');
 const key=await readBackupKey(keyPath),backup=await import('../packages/storage/dist/index.js');
 if(command==='verify'){try{if(flags['--quiesced']||flags['--fresh-destination'])fail('BACKUP_USAGE');const verified=await backup.verifyServiceBackup({source,destination,encryptionKey:key});return {operation:'verified',files:verified.files.length};}finally{key.fill(0);}}
 if(!flags['--quiesced']||command==='restore'&&!flags['--fresh-destination'])fail('BACKUP_OPERATOR_ACK_REQUIRED');
 if(!environment.DATABASE_URL)fail('BACKUP_DATABASE_REQUIRED');
 if(environment.BLOB_ROOT&&(inside(environment.BLOB_ROOT,destination)||inside(destination,environment.BLOB_ROOT)||source&&(inside(environment.BLOB_ROOT,source)||inside(source,environment.BLOB_ROOT))))fail('BACKUP_PATH_OVERLAP');
 const blobs=await storeFor(environment),pool=new Pool({connectionString:environment.DATABASE_URL}),abort=new AbortController();const interrupted=()=>abort.abort();process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
 try{
  const adapter=postgresAdapter(environment.DATABASE_URL,environment,abort.signal),migrationDirectory=new URL('../database/migrations/',import.meta.url).pathname,snapshot=c=>collectServiceInventory(c,blobs.store,{migrationDirectory});
  if(command==='create'){
   const runtime=environment.FREEZE_RUNTIME_ROOT?await import('../apps/api/dist/freeze.js').then(m=>m.loadFreezeRuntime(environment.FREEZE_RUNTIME_ROOT)):undefined;
   const result=await backup.createServiceBackup({pool,store:blobs.store,destination,encryptionKey:key,snapshot,dump:adapter.dump,...(runtime?{runtime:{metadata:runtime.runtime,files:runtime.files}}:{}),configuration:await configurationFiles(environment,keyPath)});
   return {operation:'created',backupId:result.id};
  }
  const existing=await pool.query("SELECT count(*)::integer AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");if(existing.rows[0].count!==0||(await blobs.store.listAll()).length!==0)fail('BACKUP_DESTINATION_NOT_EMPTY');
  await backup.restoreServiceBackup({pool,store:blobs.store,source,destination,encryptionKey:key,snapshot,restore:adapter.restore});return {operation:'restored-and-verified'};
 }finally{process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);await pool.end();blobs.dispose();key.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await main();console.log(JSON.stringify(result));}catch{console.error('Service backup failed. Source and prior backups are retained; review private configuration, quiescence and fresh destination before retrying.');process.exitCode=1;}
}
