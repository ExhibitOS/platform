// SPDX-License-Identifier: AGPL-3.0-or-later
// Prepare a release manifest only after independent review of the exact input.
// Signing and admission remain the owning application's responsibility.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdtemp, open, readFile, readdir, realpath, lstat, rm, writeFile, rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const BASELINE='650e0f2ea517665cb07f5435108e66044431401e84ff3a78ef36d5218868d5c2';
const SOURCE='a336991a643991e2ff71125bc567cd04c3e95de6';
const PRODUCER='ba55e50a7f1163cfdfbb864f3656716c20833a8c1924086180e1aa82a8475442';
const TEAM='W563ZQD9G6', CERT='805040A7D2F984CAEE1B7AD8378765E215FAB2E1';
// Populated only by a reviewed source change binding an affirmative notice and
// corresponding-source delivery determination to this exact baseline.
const REDISTRIBUTION_REVIEWED_BASELINES=new Set();
const SIGNED_PATHS=new Set([
 'bin/node',...['createdb','initdb','pg_dump','pg_isready','pg_restore','postgres','psql'].map(x=>`postgres/bin/${x}`),
 ...['libcrypto.3.dylib','libicudata.77.1.dylib','libicui18n.77.1.dylib','libicuuc.77.1.dylib','liblz4.1.10.0.dylib','libpq.5.dylib','libssl.3.dylib','libxml2.16.dylib','libzstd.1.5.7.dylib','postgresql/dict_snowball.dylib','postgresql/plpgsql.dylib'].map(x=>`postgres/lib/${x}`)
]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('NATIVE_FINALIZE_INVALID');};
const outside=(a,b)=>a!==b&&!a.startsWith(b+sep)&&!b.startsWith(a+sep);
async function readRegular(path,max){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat();if(!before.isFile()||before.size>max)fail();
  const chunks=[];let length=0;
  for await(const chunk of file.createReadStream({autoClose:false})){length+=chunk.length;if(length>max)fail();chunks.push(chunk);}
  const after=await file.stat();
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||length!==before.size)fail();
  return Buffer.concat(chunks,length);
 }finally{await file.close();}
}
async function inventory(root,path=root){
 const entries=[];
 for(const name of (await readdir(path)).sort()){
  const full=join(path,name),stat=await lstat(full),key=relative(root,full);
  if(stat.isSymbolicLink()){
   const target=await realpath(full);if(target!==root&&!target.startsWith(root+sep))fail();
   entries.push({path:key,link:relative(path,target)});
  }else if(stat.isDirectory())entries.push(...await inventory(root,full));
  else if(stat.isFile()){
   const file=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const before=await file.stat();if(!before.isFile()||before.dev!==stat.dev||before.ino!==stat.ino)fail();
    const digest=createHash('sha256');for await(const chunk of file.createReadStream({autoClose:false}))digest.update(chunk);
    const after=await file.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail();
    entries.push({path:key,bytes:before.size,sha256:digest.digest('hex'),executable:Boolean(before.mode&0o111)});
   }finally{await file.close();}
  }else fail();
 }
 return entries;
}
async function command(executable,args){
 return await new Promise((ok,reject)=>{
  const p=spawn(executable,args,{stdio:['ignore','pipe','pipe']});let out='',err='';
  p.stdout.on('data',b=>{out+=b;});p.stderr.on('data',b=>{err+=b;});
  p.once('error',reject);p.once('exit',code=>code===0?ok({out,err}):reject(Error('NATIVE_FINALIZE_SIGNATURE')));
 });
}
async function verifySignature(path,isNode){
 await command('/usr/bin/codesign',['--verify','--strict',path]);
 const {out,err}=await command('/usr/bin/codesign',['--display','--verbose=4','--entitlements',':-',path]);
 const report=out+err;
 if(!report.includes('Authority=Developer ID Application:')||!report.includes(`TeamIdentifier=${TEAM}`)||!/^Timestamp=.+$/m.test(report)||!/flags=.*\bruntime\b/.test(report))fail();
 const keys=[...report.matchAll(/<key>([^<]+)<\/key>/g)].map(m=>m[1]);
 if(isNode ? keys.length!==1||keys[0]!=='com.apple.security.cs.allow-jit'||!/<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\s*\/>/.test(report) : keys.length!==0)fail();
 const temp=await mkdtemp(join(tmpdir(),'exhibitos-cert-'));
 try{
  const prefix=join(temp,'cert');await command('/usr/bin/codesign',['--display','--extract-certificates',prefix,path]);
  if(createHash('sha1').update(await readFile(prefix+'0')).digest('hex').toUpperCase()!==CERT)fail();
 }finally{await rm(temp,{recursive:true,force:true});}
}

// Exported pure comparison has no authority to create a release manifest.
export function compareSignedInventory(baseline,actual,rows){
 if(!Array.isArray(baseline)||!Array.isArray(actual)||!Array.isArray(rows)||rows.length!==SIGNED_PATHS.size)fail();
 const old=new Map(baseline.map(x=>[x.path,x])),now=new Map(actual.map(x=>[x.path,x])),signed=new Map(rows.map(x=>[x.path,x]));
 if(old.size!==baseline.length||now.size!==actual.length||signed.size!==rows.length||old.size!==now.size||[...SIGNED_PATHS].some(p=>!signed.has(p)))fail();
 for(const [path,entry] of old){
  const current=now.get(path);if(!current)fail();
  if(!SIGNED_PATHS.has(path)){if(JSON.stringify(entry)!==JSON.stringify(current))fail();continue;}
  const row=signed.get(path);
  if(entry.link!==undefined||current.link!==undefined||row.before!==entry.sha256||row.after!==current.sha256||entry.executable!==current.executable||!Number.isInteger(row.beforeMode)||row.beforeMode!==0o755||row.afterMode!==0o755||Boolean(row.beforeMode&0o111)!==entry.executable)fail();
 }
 return true;
}

export async function finalizeNativeRuntime({signedRoot,originalRoot,operationRoot,originalManifest,receiptPath}){
 for(const p of [signedRoot,originalRoot,operationRoot,originalManifest,receiptPath])if(!isAbsolute(p??'')||resolve(p)!==p)fail();
 const root=await realpath(signedRoot),original=await realpath(originalRoot),operation=await realpath(operationRoot),manifestPath=await realpath(originalManifest),receiptReal=await realpath(receiptPath);
 const originals=join(operation,'originals');
 if(root!==signedRoot||original!==originalRoot||operation!==operationRoot||manifestPath!==originalManifest||receiptReal!==receiptPath||!outside(root,original)||!outside(root,operation)||!outside(original,operation)||manifestPath!==join(originals,'manifest.json')||!receiptReal.startsWith(operation+sep))fail();
 for(const dir of [root,original,operation,originals]){const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)fail();}
 const manifestBytes=await readRegular(manifestPath,16*1024*1024);
 if(sha(manifestBytes)!==BASELINE||sha(await readRegular(join(original,'manifest.json'),16*1024*1024))!==BASELINE||sha(await readRegular(join(root,'manifest.json'),16*1024*1024))!==BASELINE)fail();
 const baseline=JSON.parse(manifestBytes),receipt=JSON.parse(await readRegular(receiptReal,1024*1024));
 if(baseline.mode!=='local-validation'||baseline.officialSigned!==false||baseline.redistributionQualified!==false||baseline.sourceCommit!==SOURCE||baseline.producerSHA256!==PRODUCER||receipt.version!==1||receipt.state!=='runtime-prepared'||!Array.isArray(receipt.signedFiles))fail();
 const originalInventory=(await inventory(original)).filter(x=>x.path!=='manifest.json');
 if(JSON.stringify(originalInventory)!==JSON.stringify(baseline.files))fail();
 const actual=(await inventory(root)).filter(x=>x.path!=='manifest.json');
 compareSignedInventory(baseline.files,actual,receipt.signedFiles);
 // The historical manifest pins only executable bits. Equality here protects
 // the retained original; it does not attest its original non-executable modes.
 async function checkModes(){
  for(const entry of baseline.files){
   if(entry.link!==undefined)continue;
   const a=await lstat(join(original,entry.path)),b=await lstat(join(root,entry.path));
   if((a.mode&0o7777)!==(b.mode&0o7777))fail();
   if(SIGNED_PATHS.has(entry.path)&&((a.mode&0o7777)!==0o755||a.dev===b.dev&&a.ino===b.ino))fail();
  }
 }
 await checkModes();
 for(const row of receipt.signedFiles){
  if(!isAbsolute(row.original??'')||resolve(row.original)!==row.original||!row.original.startsWith(originals+sep))fail();
  const saved=await realpath(row.original),stat=await lstat(row.original),target=join(root,row.path),targetStat=await lstat(target);
  if(row.beforeMode!==0o755||saved!==row.original||!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||sha(await readRegular(saved,256*1024*1024))!==row.before||(targetStat.mode&0o7777)!==row.afterMode)fail();
  await verifySignature(target,row.path==='bin/node');
 }
 // Recheck after signature verification; the owning workflow must retain
 // exclusive control, because these checks are point-in-time, not a lock.
 if(JSON.stringify((await inventory(root)).filter(x=>x.path!=='manifest.json'))!==JSON.stringify(actual)||JSON.stringify((await inventory(original)).filter(x=>x.path!=='manifest.json'))!==JSON.stringify(baseline.files)||sha(await readRegular(join(root,'manifest.json'),16*1024*1024))!==BASELINE||sha(await readRegular(join(original,'manifest.json'),16*1024*1024))!==BASELINE)fail();
 await checkModes();
 // No input-supplied flag can assert the independent redistribution review.
 if(!REDISTRIBUTION_REVIEWED_BASELINES.has(BASELINE))throw Error('NATIVE_FINALIZE_REVIEW_PENDING');
 const final={...baseline,mode:'release',producerSHA256:sha(await readFile(fileURLToPath(import.meta.url))),files:actual,redistributionQualified:true,officialSigned:true,remaining:'Exact signed runtime candidate; admission, owning application and release delivery are independently qualified by Manager.'};
 const temp=join(root,`.manifest-${process.pid}.tmp`);await writeFile(temp,JSON.stringify(final,null,2)+'\n',{flag:'wx',mode:0o600});
 await rename(temp,join(root,'manifest.json'));
 return {sourceCommit:SOURCE,producerSHA256:final.producerSHA256,manifestSHA256:sha(await readRegular(join(root,'manifest.json'),16*1024*1024))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [config,...extra]=process.argv.slice(2);if(!config||extra.length)fail();console.log(JSON.stringify(await finalizeNativeRuntime(JSON.parse(await readFile(config,'utf8')))));}
 catch(error){console.error(/^NATIVE_FINALIZE_[A-Z_]+$/.test(error.message)?error.message:'NATIVE_FINALIZE_FAILED');process.exitCode=1;}
}
