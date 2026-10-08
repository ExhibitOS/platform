// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual local Docker/PostgreSQL qualification, never an operator restore tool.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,open,readFile,realpath,rename,stat,writeFile,statfs} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {FileBlobStore,migrate,collectServiceInventory,createServiceBackup,restoreServiceBackup,hashBackupFile} from '../packages/storage/dist/index.js';
import {bootstrap} from '../apps/api/dist/auth.js';
import {IsolatedBackends} from './service-backup-adapters.mjs';

const image=process.env.BACKUP_RECOVERY_IMAGE;
assert.match(image??'',/^sha256:[a-f0-9]{64}$/,'Select an immutable, newly owned qualification Runtime image');
const images=JSON.parse(await readFile(new URL('../database/images.json',import.meta.url))),backends=new IsolatedBackends(images);
const inspect=id=>JSON.parse(backends.run(['image','inspect',id]))[0];
const selected=inspect(image),label='runtime-recovery-e033f3f';
assert.equal(selected.Id,image);assert.equal(selected.Config.Labels?.['exhibitos.qualification'],label);
assert.deepEqual(selected.RepoTags,['exhibitos-local:recovery-e033f3f']);assert.deepEqual(selected.RepoDigests??[],[`exhibitos-local@${image}`]);
assert.equal(backends.run(['ps','-aq','--filter',`ancestor=${image}`]),'');
const space=await statfs('/private/tmp');assert(space.bavail*space.bsize>Math.max(6*1024**3,selected.Size*6),'Retain old data; image recovery proof requires six-image-size free space');
const root=await realpath(await mkdtemp('/private/tmp/exhibitos-image-recovery-'));await mkdir(join(root,'source-blobs'),{mode:0o700});
const checks=[],key=randomBytes(32),tenant=randomUUID(),password=randomBytes(24).toString('hex'),subject='synthetic.image.recovery';let runtimeName;
const migrationDirectory=new URL('../database/migrations/',import.meta.url).pathname;
const step=async(name,fn)=>{await fn();checks.push(name);console.log(`PASS ${name}`);};
async function saveImage(path){
 const file=await open(path,'wx',0o600);
 try{const child=spawn(process.env.DOCKER_BIN??'docker',['image','save',image],{stdio:['ignore',file.fd,'pipe']});child.stderr.resume();const timer=setTimeout(()=>child.kill('SIGTERM'),120000);try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('IMAGE_SAVE_FAILED')));});await file.sync();}finally{clearTimeout(timer);}}finally{await file.close();}
}
async function loadImage(path){
 const file=await open(path,'r');try{const child=spawn(process.env.DOCKER_BIN??'docker',['image','load'],{stdio:[file.fd,'pipe','pipe']});child.stdout.resume();child.stderr.resume();const timer=setTimeout(()=>child.kill('SIGTERM'),120000);try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('IMAGE_LOAD_FAILED')));});}finally{clearTimeout(timer);}}finally{await file.close();}
}
async function origin(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return `http://127.0.0.1:${port}`;}
try{
 const source=await backends.postgres('image-source'),target=await backends.postgres('image-target'),sourceStore=new FileBlobStore(join(root,'source-blobs'));
 await migrate(source.pool,migrationDirectory);await bootstrap(source.pool,tenant,subject,password);
 await source.pool.query('CREATE TABLE synthetic_image_recovery(id integer PRIMARY KEY,witness text NOT NULL)');await source.pool.query("INSERT INTO synthetic_image_recovery VALUES(1,'synthetic preserved installation')");
 await sourceStore.put('synthetic/recovery/orphan',Buffer.from('synthetic retained blob'));
 const snapshot=store=>client=>collectServiceInventory(client,store,{migrationDirectory});
 const archivePath=join(root,'runtime-image.docker.tar');await step('stream-save exact owned Runtime image',()=>saveImage(archivePath));
 const artifact=await hashBackupFile(archivePath),deployment=new Map([['images/platform.docker.tar',{path:archivePath,...artifact}]]);
 const {privateKey}=generateKeyPairSync('ed25519');const signing=Buffer.from(JSON.stringify({name:'exhibitos-freeze-ed25519',schemaVersion:'1.0.0-draft.1',privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64')}));
 const configuration=new Map([['freeze-signing-key.json',signing]]),backup=join(root,'encrypted-backup');
 await step('encrypt actual PG rows blobs credentials signing configuration and image archive',async()=>{await createServiceBackup({pool:source.pool,store:sourceStore,destination:backup,encryptionKey:key,snapshot:snapshot(sourceStore),dump:(path,token)=>backends.pgFile(source,path,'dump',token),configuration,deployment});});
 await step('make only owned source DB blob archive and image unavailable',async()=>{
  await source.pool.end();backends.stop(source.name);await rename(sourceStore.root,join(root,'retained-source-blobs'));await rename(archivePath,join(root,'retained-source-image.docker.tar'));
  assert.equal(inspect(image).Config.Labels?.['exhibitos.qualification'],label);assert.equal(backends.run(['ps','-aq','--filter',`ancestor=${image}`]),'');
  backends.run(['image','rm','--no-prune',image]);assert.throws(()=>inspect(image));
 });
 const restoredStore=new FileBlobStore(join(root,'restored-blobs'));await mkdir(restoredStore.root,{mode:0o700});const candidate=join(root,'restore');let receipt;
 await step('fresh PostgreSQL/blob/config/image staging authenticates and matches full inventory',async()=>{
  receipt=await restoreServiceBackup({pool:target.pool,store:restoredStore,source:backup,encryptionKey:key,destination:candidate,snapshot:snapshot(restoredStore),restore:path=>backends.pgFile(target,path,'restore')});
  const staged=join(candidate,'deployment/images/platform.docker.tar');assert.deepEqual(await hashBackupFile(staged),artifact);assert.equal((await stat(staged)).mode&0o777,0o600);
  assert.deepEqual(await readFile(join(candidate,'configuration/freeze-signing-key.json')),signing);assert.deepEqual(await restoredStore.get('synthetic/recovery/orphan'),Buffer.from('synthetic retained blob'));
 });
 await step('trusted authenticated archive imports exact original image ID',async()=>{
  await loadImage(join(candidate,'deployment/images/platform.docker.tar'));assert.equal(inspect(image).Id,image);assert.equal(inspect(image).Config.Labels?.['exhibitos.qualification'],label);
 });
 const url=await origin(),port=new URL(url).port;
 const env={DATABASE_URL:`postgresql://postgres:${target.password}@host.docker.internal:${target.database.port}/postgres`,TENANT_ID:tenant,ADMIN_SUBJECT:subject,ADMIN_PASSWORD:randomBytes(24).toString('hex'),EXHIBITOS_PORT:port,BLOB_ROOT:'/recovery/blobs',CONFIG_ROOT:'/recovery/config'};
 runtimeName=`${backends.owner}-restored-runtime`;
 await step('run restored Runtime against only fresh restored DB/blob/config',async()=>{
  backends.run(['run','-d','--name',runtimeName,'--label',`exhibitos.service.backup.test=${backends.owner}`,'--user',`${process.getuid()}:${process.getgid()}`,'--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=128m,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges:true','-p',`127.0.0.1:${port}:8080`,'--mount',`type=bind,source=${restoredStore.root},target=/recovery/blobs`,'--mount',`type=bind,source=${candidate}/configuration,target=/recovery/config`,...Object.keys(env).flatMap(name=>['-e',name]),image],env);
  backends.containers.push(runtimeName);
  for(let n=0;;n++){try{const response=await fetch(url+'/api/v1/readiness');assert.equal(response.status,200);assert.equal((await response.json()).ready,true);break;}catch{if(n>=90)throw Error('RESTORED_RUNTIME_READINESS_FAILED');await new Promise(resolve=>setTimeout(resolve,500));}}
 });
 await step('actual restored web and original administrator credentials work',async()=>{
  const page=await fetch(url);assert.equal(page.status,200);assert.match(await page.text(),/ExhibitOS/);
  const response=await fetch(url+'/api/v1/auth/login',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({subject,password,tenantId:tenant})});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie')?.split(';')[0];assert(cookie);
  const session=await fetch(url+'/api/v1/auth/session',{headers:{cookie}});assert.equal(session.status,200);
  assert.deepEqual((await target.pool.query('SELECT witness FROM synthetic_image_recovery WHERE id=1')).rows,[{witness:'synthetic preserved installation'}]);
  assert.deepEqual(await readFile(join(candidate,'configuration/freeze-signing-key.json')),signing);
 });
 const report={format:1,checks,at:new Date().toISOString(),image,artifact,receiptId:receipt.id,sourceUnavailable:true,limits:['local Docker/macOS only; same engine catalog removal, not a fresh engine disaster restore','trusted operator-selected image; not signature/update qualification','not Manager native GUI/Windows/Podman, production dataset or full exhibition scenario']};
 await writeFile(join(root,'image-recovery-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(`Actual image recovery ${checks.length} PASS; report ${root}/image-recovery-report.json`);
}catch{await writeFile(join(root,'failed.json'),JSON.stringify({status:'failed',checks})+'\n',{mode:0o600,flag:'wx'});throw Error(`IMAGE_RECOVERY_QUALIFICATION_FAILED; private candidate retained at ${root}`);}
finally{key.fill(0);await backends.close();}
