// SPDX-License-Identifier: AGPL-3.0-or-later
import {checkedPublicProjection} from './private-agent-publication.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {constants,createReadStream,fstatSync} from 'node:fs';
import {readFile,writeFile,lstat,realpath,mkdir,rm,rename,open} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {createServer} from 'node:http';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {FLOOR_TEXTURE_FILES,SURFACE_TEXTURE_FILES} from '@exhibitos/studio-contract';
const root=fileURLToPath(new URL('../',import.meta.url)),hex=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=code=>{throw Error(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function digest(path,signal){signal?.throwIfAborted();const h=createHash('sha256');for await(const bytes of createReadStream(path)){signal?.throwIfAborted();h.update(bytes);}signal?.throwIfAborted();return h.digest('hex');}
async function plain(path,directory=false){if(!isAbsolute(path)||await realpath(path)!==path)fail('AGENT_PATH');const st=await lstat(path);if(st.isSymbolicLink()||!(directory?st.isDirectory():st.isFile())||st.uid!==process.getuid())fail('AGENT_PATH');return path;}
async function json(path,limit=1100000){await plain(path);const st=await lstat(path);if(st.size>limit)fail('AGENT_INPUT_LIMIT');return JSON.parse(await readFile(path,'utf8'));}
/** Serve only manifest-pinned built-in texture files; the renderer also checks
 * each requested descriptor against its compiled registry and digest. */
export async function attachStaticMaterialFiles(files,manifest,root,signal,registry=[...FLOOR_TEXTURE_FILES,...SURFACE_TEXTURE_FILES]){
 if(!Array.isArray(manifest?.files)||manifest.files.length>20030)fail('AGENT_EXPORT_BINDING');
 const entries=manifest.files.filter(e=>typeof e?.path==='string'&&/^(?:floor-textures|surface-material-textures)\//.test(e.path));
 if(entries.length>128)fail('AGENT_INPUT_LIMIT');
 for(const entry of entries){
  const known=registry.filter(file=>file.path===entry.path);
  if(!/^(?:floor-textures|surface-material-textures)\/(?:[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_-]+\.png$/.test(entry.path)||known.length!==1||known[0].sha256!==entry.sha256||known[0].bytes!==entry.bytes||!hex.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>16777216||files.has('/'+entry.path))fail('AGENT_EXPORT_BINDING');
  const path=join(root,entry.path);await plain(path);if((await lstat(path)).size!==entry.bytes||await digest(path,signal)!==entry.sha256)fail('AGENT_STALE');
  files.set('/'+entry.path,{path,entry:{...entry,mime:'image/png'}});
 }
}
const canonical=value=>{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);};
const equal=(a,b)=>canonical(a)===canonical(b);
/** One process owns one browser/context/output. This is a snapshot of an exact
 * immutable export; the native issuer alone owns live save/auth/CAS authority. */
export async function runPrivateAgentRenderer(inputPath,outputPath,{signal=new AbortController().signal,onStage=()=>{},publicationRuntimeRoot,publicationRuntimeSha256}={}){
 signal=AbortSignal.any([signal,AbortSignal.timeout(60000)]);signal.throwIfAborted();await plain(inputPath);const raw=await readFile(inputPath);if(raw.length>1100000)fail('AGENT_INPUT_LIMIT');const input=JSON.parse(raw),inputSha256=hash(raw);
 const checkInput=async()=>{signal=AbortSignal.any([signal,AbortSignal.timeout(60000)]);signal.throwIfAborted();await plain(inputPath);if(await digest(inputPath,signal)!==inputSha256)fail('AGENT_STALE');};
 if(input.version!==1||!['bench-proposal','surface-texture-proposal','scene-snapshot','raw-asset-comparison'].includes(input.operation))fail('AGENT_REQUEST');
 if(!isAbsolute(outputPath)||resolve(outputPath)!==outputPath)fail('AGENT_PATH');await plain(dirname(outputPath),true);
 try{await lstat(outputPath);fail('AGENT_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(input.operation==='bench-proposal'||input.operation==='surface-texture-proposal'){
  if(Object.keys(input).sort().join(',')!=='frame,operation,request,version')fail('AGENT_REQUEST');
  const reply=input.operation==='bench-proposal'?(await import(pathToFileURL(join(root,'dist-agent/bench.mjs')))).benchProposal(input.frame,input.request):(await import(pathToFileURL(join(root,'dist-agent/surface.mjs')))).surfaceTextureProposal(input.frame,input.request);await checkInput();return publish({version:1,operation:input.operation,requestId:reply.requestId,inputSha256,reply});
 }
 if(input.operation==='raw-asset-comparison')return compareRawAssets();
 const keys=['binding','candidateSha256','exportReceiptPath','exportReceiptSha256','indexSha256','oexPath','oexSha256','operation','requestId','saved','snapshot','staticRoot','version'];if(Object.hasOwn(input,'exported'))keys.push('exported');if(Object.keys(input).sort().join(',')!==keys.sort().join(','))fail('AGENT_REQUEST');
 const {saved,binding,snapshot}=input;
 const snapshotKeys=snapshot&&'inspectionCamera' in snapshot?'height,inspectionCamera,placementId,width':'height,placementId,viewpointId,width';
 if(!snapshot||Object.keys(snapshot).sort().join(',')!==snapshotKeys||snapshot.width!==640||snapshot.height!==360||!uuid.test(snapshot.placementId)||!('inspectionCamera' in snapshot)&&!uuid.test(snapshot.viewpointId))fail('AGENT_REQUEST');
 if(!uuid.test(input.requestId)||Object.keys(binding??{}).sort().join(',')!=='expectedEditVersion,expectedRevision,principalId,tenantId,workspaceId'||!['workspaceId','tenantId','principalId'].every(k=>uuid.test(binding[k]))||!Number.isSafeInteger(binding.expectedEditVersion)||binding.expectedEditVersion<0||Object.keys(saved??{}).sort().join(',')!=='draftId,etag,exhibitionId,revision'||!uuid.test(saved.exhibitionId)||!uuid.test(saved.draftId)||!Number.isSafeInteger(saved.revision)||saved.revision<1||!Number.isSafeInteger(binding.expectedRevision)||binding.expectedRevision<0||typeof saved.etag!=='string'||!new RegExp('^"studio-r'+saved.revision+'-[a-f0-9]{64}"$').test(saved.etag)||!['indexSha256','oexSha256','candidateSha256','exportReceiptSha256'].every(k=>hex.test(input[k])))fail('AGENT_BINDING');
 await plain(input.staticRoot,true);await plain(input.oexPath);if((await lstat(input.oexPath)).size>536870912)fail('AGENT_INPUT_LIMIT');await plain(input.exportReceiptPath);
 if(outputPath===input.staticRoot||!relative(input.staticRoot,outputPath).startsWith('..')||outputPath===input.oexPath||outputPath===input.exportReceiptPath||outputPath===inputPath)fail('AGENT_PATH');
 const indexPath=join(input.staticRoot,'static-publication-index.json');await plain(indexPath);const indexBytes=await readFile(indexPath);if(hash(indexBytes)!==input.indexSha256)fail('AGENT_STALE');const index=JSON.parse(indexBytes);
 const receipt=await json(input.exportReceiptPath);onStage('hashing-oex');const oexDigest=await digest(input.oexPath,signal);if(!equal(receipt.binding,binding)||!equal(receipt.saved,saved)||receipt.candidateSha256!==input.candidateSha256||receipt.indexSha256!==input.indexSha256||receipt.oexSha256!==input.oexSha256||await digest(input.exportReceiptPath,signal)!==input.exportReceiptSha256||oexDigest!==input.oexSha256)fail('AGENT_EXPORT_BINDING');
 const entries=[index.publication,...(index.assets??[]),...(index.resources??[]),...(index.furnishingNotices??[])];if(entries.length>20030)fail('AGENT_INPUT_LIMIT');const files=new Map();
 for(const entry of entries){if(!entry||!hex.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>33554432||!new RegExp('^data/'+entry.sha256+'\\.(json|bin)$').test(entry.path))fail('AGENT_EXPORT_BINDING');const path=join(input.staticRoot,entry.path);await plain(path);if((await lstat(path)).size!==entry.bytes||await digest(path,signal)!==entry.sha256)fail('AGENT_STALE');files.set('/'+entry.path,{path,entry});}
 const publication=await json(join(input.staticRoot,index.publication.path));
 const exported=input.exported??{exhibitionId:saved.exhibitionId,publicationId:publication.publication.id,candidateSha256:input.candidateSha256};
 if(Object.keys(exported).sort().join(',')!=='candidateSha256,exhibitionId,publicationId'||!uuid.test(exported.exhibitionId)||!uuid.test(exported.publicationId)||!hex.test(exported.candidateSha256)||publication.exhibition.id!==exported.exhibitionId||publication.publication.id!==exported.publicationId||publication.publication.revisionSha256!==exported.candidateSha256||hash(canonical(publication.exhibition))!==exported.candidateSha256)fail('AGENT_EXPORT_BINDING');
 let exportManifest;
 if(input.exported){
  const {intent,completed,staticExport}=receipt.publication??{};
  if(!equal(receipt.exported,exported)||!intent||!completed||!staticExport||intent.sourceExhibitionId!==saved.exhibitionId||intent.sourceEtag!==saved.etag||completed.sourceExhibitionId!==saved.exhibitionId||completed.sourceEtag!==saved.etag||!uuid.test(intent.publishRequestId)||intent.publishRequestId!==completed.publishRequestId||intent.snapshot?.exhibitionId!==completed.snapshotExhibitionId||intent.planBindingSha256!==completed.planBindingSha256||completed.publication?.publicationId!==exported.publicationId||completed.publication?.revisionSha256!==exported.candidateSha256||completed.publication?.status!=='published'||staticExport.publicationId!==exported.publicationId||staticExport.revisionSha256!==exported.candidateSha256||staticExport.indexSha256!==input.indexSha256||staticExport.output!==input.staticRoot)fail('AGENT_PUBLICATION_BINDING');
  const manifestPath=join(input.staticRoot,'static-export-manifest.json');await plain(manifestPath);if(!hex.test(staticExport.manifestSha256)||(await lstat(manifestPath)).size>1048576||await digest(manifestPath,signal)!==staticExport.manifestSha256)fail('AGENT_PUBLICATION_BINDING');exportManifest={path:manifestPath,sha256:staticExport.manifestSha256};
  const manifest=await json(manifestPath);if(manifest.format!=='exhibitos-static-publication-v1'||manifest.publicationId!==exported.publicationId||manifest.revisionSha256!==exported.candidateSha256||manifest.indexSha256!==input.indexSha256)fail('AGENT_PUBLICATION_BINDING');await attachStaticMaterialFiles(files,manifest,input.staticRoot,signal);
 }

 const projection=input.exported?await checkedPublicProjection({receipt,publication,files,runtimeRoot:publicationRuntimeRoot,runtimeSha256:publicationRuntimeSha256,signal}):undefined;
 if(projection&&(!projection.placements.some(p=>p.exported===snapshot.placementId)||snapshot.viewpointId&&!projection.viewpoints.some(p=>p.exported===snapshot.viewpointId)))fail('AGENT_PROJECTION_TARGET');
 const recheck=async()=>{await checkInput();for(const [path,expected] of [[indexPath,input.indexSha256],[input.exportReceiptPath,input.exportReceiptSha256],[input.oexPath,input.oexSha256],...(exportManifest?[[exportManifest.path,exportManifest.sha256]]:[]),...(projection?[[join(publicationRuntimeRoot,'manifest.json'),publicationRuntimeSha256],[join(publicationRuntimeRoot,'platform/apps/api/dist/publication.js'),projection.producer.publicationModuleSha256],[join(publicationRuntimeRoot,'platform/apps/api/dist/viewer-variants.js'),projection.producer.measureModuleSha256]]:[])]){await plain(path);if(await digest(path,signal)!==expected)fail('AGENT_STALE');}for(const module of projection?.producer.verifiedRuntimeModules??[]){const path=join(publicationRuntimeRoot,module.path);await plain(path);if(await digest(path,signal)!==module.sha256)fail('AGENT_STALE');}for(const {path,entry} of files.values()){await plain(path);if(await digest(path,signal)!==entry.sha256)fail('AGENT_STALE');}signal.throwIfAborted();};
 let browser,server;const errors=[];const nonce=randomUUID();
 try{
  server=createServer(async(req,res)=>{try{if(req.headers.host!==`127.0.0.1:${server.address().port}`||req.method!=='GET'){res.writeHead(403).end();return;}const url=req.url;
   if(url==='/'+nonce){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset="utf-8"><meta name="exhibitos-static-index" content="${input.indexSha256}"><link rel="stylesheet" href="/renderer.css"><script type="module" src="/renderer.js"></script>`);return;}
   let bytes,mime;if(url==='/static-publication-index.json'){bytes=indexBytes;mime='application/json';}else if(files.has(url)){const {path,entry}=files.get(url);await plain(path);bytes=await readFile(path);if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)fail('AGENT_STALE');mime=entry.mime;}else if(url==='/renderer.js'||url==='/renderer.css'){bytes=await readFile(join(root,'dist-agent',url.slice(1)));mime=url.endsWith('.js')?'text/javascript':'text/css';}else{res.writeHead(404).end();return;}res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','no-store');res.end(bytes);
  }catch{res.writeHead(409).end();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});onStage('server-ready');signal.throwIfAborted();
  const {chromium}=await import('@playwright/test');onStage('launch-start');browser=await chromium.launch({headless:true});signal.throwIfAborted();
  const abort=()=>{void browser?.close();};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  try{
   const context=await browser.newContext({viewport:{width:960,height:640},serviceWorkers:'block',acceptDownloads:false});signal.throwIfAborted();
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===`http://127.0.0.1:${server.address().port}`?route.continue():route.abort();});
   await page.goto(`http://127.0.0.1:${server.address().port}/${nonce}`);await page.waitForFunction(()=>typeof window.captureExport==='function');onStage('renderer-ready');
   const image=await page.evaluate(value=>window.captureExport(value),{requestId:input.requestId,candidateSha256:exported.candidateSha256,snapshot});signal.throwIfAborted();if(errors.length)fail('AGENT_RENDER');
   const png=Buffer.from(image.pngBase64,'base64');if(png.length>524288||png.length<33||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.readUInt32BE(16)!==640||png.readUInt32BE(20)!==360||image.target.ready!==true||image.target.placementId!==snapshot.placementId)fail('AGENT_PNG');
   delete image.pngBase64;onStage('encoded');await recheck();const result={version:1,operation:input.operation,requestId:input.requestId,inputSha256,binding,saved,provenance:{kind:'snapshot-of-export',exportReceiptSha256:input.exportReceiptSha256,indexSha256:input.indexSha256,oexSha256:input.oexSha256,candidateSha256:input.candidateSha256,liveCMSRechecked:false},...image,candidateSha256:input.candidateSha256,...(input.exported?{exported,projection}:{}),png:{path:'scene.png',sha256:hash(png),bytes:png.length},browser:{version:browser.version(),headless:true}};
   await browser.close();browser=undefined;await new Promise(resolve=>server.close(resolve));server=undefined;await recheck();return await publish(result,png,recheck);
  }finally{signal.removeEventListener('abort',abort);}
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
 async function compareRawAssets(){
  const roles=['reference','candidate'];
  const {settings}=input;
  const camera=settings?.inspectionCamera;
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000);
  const keys=(value,expected)=>value&&Object.keys(value).sort().join(',')===expected;
  if(!keys(input,'candidate,operation,reference,requestId,settings,version')||!uuid.test(input.requestId)||
    !keys(settings,'height,inspectionCamera,lightPreset,width')||settings.width!==640||settings.height!==360||settings.lightPreset!=='neutral-v1'||
    !keys(camera,'fov,position,target')||!vector(camera.position)||!vector(camera.target)||!Number.isFinite(camera.fov)||
    camera.fov<10||camera.fov>120||camera.position.reduce((sum,n,i)=>sum+(n-camera.target[i])**2,0)<=1e-12)fail('AGENT_REQUEST');

  const readAsset=async role=>{
   const asset=input[role];
   await plain(asset.path);
   const file=await open(asset.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.uid!==process.getuid()||stat.size!==asset.bytes)fail('AGENT_STALE');
    const buffer=Buffer.allocUnsafe(asset.bytes+1);
    let offset=0;
    while(offset<buffer.length){
     signal.throwIfAborted();
     const {bytesRead}=await file.read(buffer,offset,buffer.length-offset,offset);
     if(!bytesRead)break;
     offset+=bytesRead;
    }
    const bytes=buffer.subarray(0,offset);
    if(offset!==asset.bytes||hash(bytes)!==asset.sha256)fail('AGENT_STALE');
    return bytes;
   }finally{await file.close();}
  };
  for(const role of roles){
   const asset=input[role];
   if(!keys(asset,'bytes,mime,path,sha256')||typeof asset.path!=='string'||asset.mime!=='model/gltf-binary'||
    !hex.test(asset.sha256)||!Number.isSafeInteger(asset.bytes)||asset.bytes<28||asset.bytes>32*1024*1024)fail('AGENT_REQUEST');
   const bytes=await readAsset(role);
   await new Promise((resolve,reject)=>{
    const child=execFile(process.execPath,['--max-old-space-size=128',join(root,'dist-agent/validation-worker.mjs'),asset.mime],{
     signal,timeout:5000,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:process.env.PATH},
    });
    let stdout='',runtimeFailure=false;
    child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;});
    child.stderr.on('data',()=>{runtimeFailure=true;});
    child.stdin.on('error',()=>{});
    child.on('error',()=>{runtimeFailure=true;});
    child.once('close',code=>{
     if(signal.aborted)reject(signal.reason);
     else if(!runtimeFailure&&code===0&&stdout.trim()==='VALID')resolve();
     else reject(Error(!runtimeFailure&&code===1&&!stdout.trim()?'AGENT_MODEL_FORMAT':'AGENT_VALIDATOR_UNAVAILABLE'));
    });
    child.stdin.end(bytes);
   });
  }

  let server,browser;
  const nonce=randomUUID(),images=new Map();
  try{
   server=createServer(async(req,res)=>{
    try{
     if(req.headers.host!==`127.0.0.1:${server.address().port}`||req.method!=='GET'){res.writeHead(403).end();return;}
     res.setHeader('Cache-Control','no-store');
     if(req.url==='/'+nonce){
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><meta charset="utf-8"><script type="module" src="/renderer.js"></script>');
     }else if(req.url==='/renderer.js'){
      res.setHeader('Content-Type','text/javascript');
      res.end(await readFile(join(root,'dist-agent/renderer.js')));
     }else if(roles.some(role=>req.url==='/'+nonce+'/raw/'+role)){
      res.setHeader('Content-Type','model/gltf-binary');
      res.end(await readAsset(req.url.split('/').at(-1)));
     }else res.writeHead(404).end();
    }catch{res.writeHead(409).end();}
   });
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const origin=`http://127.0.0.1:${server.address().port}`;
   const {chromium}=await import('@playwright/test');
   signal.throwIfAborted();
   browser=await chromium.launch({headless:true});
   const close=()=>{void browser.close().catch(()=>{});};
   signal.addEventListener('abort',close,{once:true});
   try{
    signal.throwIfAborted();
    for(const role of roles){
     const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
     try{
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await page.goto(origin+'/'+nonce);
      await page.waitForFunction(()=>typeof window.captureRawAsset==='function');
      const asset=input[role];
      const capture=await page.evaluate(async value=>{
       try{return {image:await window.captureRawAsset(value)};}
       catch(error){return {code:error instanceof Error?error.message:'AGENT_RENDER_FAILED'};}
      },{role,bytes:asset.bytes,sha256:asset.sha256,camera});
      if(errors.length)fail('AGENT_RENDER');
      if(!capture.image)fail(capture.code==='MODEL_RESIDENT_BUDGET'?'AGENT_MODEL_RESIDENT_BUDGET':capture.code);
      const {pngBase64,...diagnostics}=capture.image;
      const bytes=Buffer.from(pngBase64,'base64');
      if(bytes.length>524288||bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
        bytes.readUInt32BE(16)!==640||bytes.readUInt32BE(20)!==360)fail('AGENT_PNG');
      images.set(role,{bytes,result:{sha256:asset.sha256,bytes:asset.bytes,png:{path:role+'.png',sha256:hash(bytes),bytes:bytes.length},...diagnostics}});
     }finally{await context.close();}
    }
   }finally{signal.removeEventListener('abort',close);}
  }finally{
   try{await browser?.close();}
   finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));}
  }
  const result={version:1,operation:input.operation,requestId:input.requestId,inputSha256,settings,
   reference:images.get('reference').result,candidate:images.get('candidate').result};
  signal.throwIfAborted();
  try{await mkdir(outputPath,{mode:0o700});}
  catch(error){if(error.code==='EEXIST')fail('AGENT_OUTPUT_EXISTS');throw error;}
  try{
   for(const {bytes,result:{png}} of images.values())await writeFile(join(outputPath,png.path),bytes,{flag:'wx',mode:0o600,signal});
   const marker=join(outputPath,'.result-'+randomUUID());
   await writeFile(marker,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600,signal});
   await checkInput();
   for(const role of roles)await readAsset(role);
   signal.throwIfAborted();
   await rename(marker,join(outputPath,'result.json'));
   return result;
  }catch(error){await rm(outputPath,{recursive:true,force:true});throw error;}
 }
 async function publish(result,png,recheck=checkInput){
  await recheck();let created=false;
  try{await mkdir(outputPath,{mode:0o700});created=true;if(png)await writeFile(join(outputPath,'scene.png'),png,{flag:'wx',mode:0o600});await recheck();await writeFile(join(outputPath,'result.json'),JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});signal.throwIfAborted();return result;}
  catch(error){if(created)await rm(outputPath,{recursive:true});throw error;}
 }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),abort=new AbortController();let finished=false;
 const cancel=()=>{if(!finished)abort.abort(Error('AGENT_CANCELLED'));};
 try{
  if(![4,8].includes(args.length)||args[0]!=='--input'||args[2]!=='--output'||args.length===8&&(args[4]!=='--publication-runtime'||args[6]!=='--publication-runtime-sha'||!hex.test(args[7])))fail('AGENT_USAGE');const stat=fstatSync(0);if(!stat.isFIFO()&&!stat.isSocket())fail('AGENT_OWNER_PIPE_REQUIRED');
  process.stdin.setEncoding('utf8');let count=0;process.stdin.on('data',chunk=>{count+=Buffer.byteLength(chunk);if(count>128||chunk.trim()!=='{"cancel":true}')abort.abort(Error('AGENT_CANCELLED'));else cancel();});process.stdin.once('end',cancel);process.stdin.once('error',cancel);process.stdin.resume();process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
  const result=await runPrivateAgentRenderer(resolve(args[1]),resolve(args[3]),{signal:abort.signal,...(args.length===8?{publicationRuntimeRoot:resolve(args[5]),publicationRuntimeSha256:args[7]}:{})});finished=true;console.log(JSON.stringify(result));
 }catch(error){finished=true;const code=abort.signal.aborted?'AGENT_CANCELLED':/^(AGENT_|BENCH_INSPECTOR_|SCENE_SNAPSHOT_)[A-Z_]+$/.test(error?.message)?error.message:'AGENT_RENDER_FAILED';console.log(JSON.stringify({version:1,status:'failed',code}));process.exitCode=1;}
 finally{process.stdin.destroy();}
}
