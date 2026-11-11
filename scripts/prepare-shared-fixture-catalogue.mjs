// SPDX-License-Identifier: AGPL-3.0-or-later
// Ordinary curated catalogue producer, using the same bounded product workers
// as furnishing admission. This command never changes an installed runtime,
// database, original delivery, catalogue descriptor or publication.
import {constants} from 'node:fs';
import {lstat,realpath,open,mkdtemp,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {produceSharedFixtureCandidate} from '../apps/api/src/shared-fixture-producer.ts';
import {parseStaticJson} from '../apps/web/src/static-json.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('SHARED_FIXTURE_PRODUCER_INVALID');};
async function readPinned(path,bytes,hash){
 if(typeof path!=='string'||!path.startsWith('/')||resolve(path)!==path||await realpath(path)!==path||!Number.isSafeInteger(bytes)||bytes<1||bytes>8*1024*1024||!/^[a-f0-9]{64}$/.test(hash))fail();
 let current='/';for(const part of path.split('/').filter(Boolean)){current=join(current,part);if((await lstat(current)).isSymbolicLink())fail();}
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=await file.stat();if(!stat.isFile()||stat.size!==bytes)fail();const data=await file.readFile();if(data.length!==bytes||sha(data)!==hash)fail();return data;}finally{await file.close();}
}
async function durable(path,bytes){const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}}
async function syncDirectory(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}

let stage;
try{
 if(process.argv.length!==4||process.argv[2]!=='--request')fail();
 const requestPath=resolve(process.argv[3]);if(await realpath(requestPath)!==requestPath)fail();
 const requestFile=await open(requestPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let requestBytes;
 try{const stat=await requestFile.stat();if(!stat.isFile()||stat.size>65536)fail();requestBytes=await requestFile.readFile();}finally{await requestFile.close();}
 const request=parseStaticJson(requestBytes,65536);
 const fields=['sourcePath','sourceSHA256','sourceBytes','noticePath','noticeSHA256','noticeBytes','licenseId','outputDir'];
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).sort().join(',')!==fields.sort().join(',')||request.licenseId!=='CC0-1.0'||typeof request.outputDir!=='string'||!request.outputDir.startsWith('/')||resolve(request.outputDir)!==request.outputDir||request.noticeBytes>65536)fail();
 const repo=fileURLToPath(new URL('../',import.meta.url)),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
 const implementation=[];
 for(const path of ['scripts/prepare-shared-fixture-catalogue.mjs','apps/api/src/shared-fixture-producer.ts','apps/api/src/light-fixture-preparation.ts','apps/api/src/light-fixture-preparation-process.ts','apps/api/src/light-fixture-preparation-worker.ts','apps/api/src/workspace-furnishing-glb.ts','apps/api/src/validation-worker.ts']){
  const bytes=execFileSync('git',['show',`${sourceCommit}:${path}`],{cwd:repo,maxBuffer:4*1024*1024});
  const actual=await readPinned(join(repo,path),bytes.length,sha(bytes));implementation.push({path,sha256:sha(actual)});
 }
 const source=await readPinned(request.sourcePath,request.sourceBytes,request.sourceSHA256),notice=await readPinned(request.noticePath,request.noticeBytes,request.noticeSHA256);
 const parent=dirname(request.outputDir);if(await realpath(parent)!==parent)fail();const parentStat=await lstat(parent);if(!parentStat.isDirectory()||parentStat.uid!==process.getuid?.()||(parentStat.mode&0o022)!==0)fail();
 for(const path of [request.sourcePath,request.noticePath]){const relation=relative(request.outputDir,path);if(relation===''||!relation.startsWith('..')&&!relation.startsWith('/'))fail();}
 try{await lstat(request.outputDir);fail();}catch(error){if(error.code!=='ENOENT')throw error;}
 const result=await produceSharedFixtureCandidate({source,notice,authority:{source:{bytes:request.sourceBytes,sha256:request.sourceSHA256},notice:{bytes:request.noticeBytes,sha256:request.noticeSHA256},licenseId:request.licenseId},producer:{sourceCommit,implementationSHA256:sha(Buffer.from(JSON.stringify(implementation)))}});
 stage=await mkdtemp(join(parent,'.shared-fixture-producer-'));
 const artifacts=new Map([['source.glb',result.source],['source-LICENSE-NOTICE.txt',result.sourceNotice],['model.glb',result.bytes],['LICENSE-NOTICE.txt',result.notice],['producer-receipt.json',Buffer.from(JSON.stringify(result.receipt,null,2)+'\n')]]);
 const files=[];for(const [path,bytes]of artifacts){await durable(join(stage,path),bytes);files.push({path,bytes:bytes.length,sha256:sha(bytes)});}
 const manifest=Buffer.from(JSON.stringify({format:'exhibitos-shared-fixture-producer-v1',sourceCommit,implementation,requestSHA256:sha(requestBytes),receiptSHA256:result.receipt.sha256,files},null,2)+'\n');
 await durable(join(stage,'integrity.json'),manifest);await syncDirectory(stage);
 try{await lstat(request.outputDir);fail();}catch(error){if(error.code!=='ENOENT')throw error;}
 await rename(stage,request.outputDir);stage=undefined;await syncDirectory(parent);
 console.log(JSON.stringify({output:request.outputDir,manifestSHA256:sha(manifest),source:result.receipt.source,renderable:result.receipt.renderable,notice:result.receipt.notice,receiptSHA256:result.receipt.sha256,workerDrained:true,sourceCommit}));
}catch(error){console.error(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'SHARED_FIXTURE_PRODUCER_FAILED');process.exitCode=1;}
finally{if(stage)await rm(stage,{recursive:true,force:true});}
