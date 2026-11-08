// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {lstat,mkdtemp,readFile,realpath,rename,rm} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createPagesPublicationSource} from './pages-publication-source.mjs';
import {exportStaticPublication} from './export-static-publication.mjs';
import {localStaticPublicationSource,assertSamePublicationContent,retainedPrivateEditor} from './local-static-publication-source.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const keys=['sourceDir','sourceManifestSha256','indexSha256','publicationId','revisionSha256','targetRuntimeDir','targetManifestSha256','stagedOutputDir'];
const hex=/^[a-f0-9]{64}$/;
const fail=code=>{throw Error(code);};
const within=(path,parent)=>path===parent||path.startsWith(parent+sep);

/** Runs only inside the verified target runtime. Manager supplies an immutable private source snapshot and exclusively owns the staging parent; Manager alone commits the final destination. */
export async function refreshStaticPublication(request,{cancelled=()=>false}={}){
 if(!request||typeof request!=='object'||Array.isArray(request)||(Object.keys(request).length!==keys.length||keys.some(k=>!Object.hasOwn(request,k)))||keys.some(k=>typeof request[k]!=='string'||!request[k])||!hex.test(request.targetManifestSha256))fail('REFRESH_REQUEST_INVALID');
 const source=resolve(request.sourceDir),runtime=resolve(request.targetRuntimeDir),output=resolve(request.stagedOutputDir),parent=dirname(output);
 if(![request.sourceDir,request.targetRuntimeDir,request.stagedOutputDir].every(p=>p.startsWith('/'))||within(output,source)||within(source,output)||within(output,runtime)||within(runtime,output))fail('REFRESH_PATH_INVALID');
 if(await realpath(source)!==source||await realpath(runtime)!==runtime||await realpath(parent)!==parent)fail('REFRESH_PATH_INVALID');
 const scriptRuntime=resolve(dirname(fileURLToPath(import.meta.url)),'../..');if(await realpath(scriptRuntime)!==runtime)fail('REFRESH_RUNTIME_INVALID');
 if(hash(await readFile(join(runtime,'manifest.json')))!==request.targetManifestSha256)fail('REFRESH_RUNTIME_INVALID');
 try{await lstat(output);fail('REFRESH_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const local=await localStaticPublicationSource(request,{cancelled});
 const pinned=createPagesPublicationSource({origin:local.origin,publicationId:request.publicationId,revisionSha256:request.revisionSha256,indexSha256:request.indexSha256,fetch:local.fetch});
 const base=`/api/v1/publications/${request.publicationId}`;
 const fetcher=async input=>{if(cancelled())fail('REFRESH_CANCELLED');const url=new URL(input);if(url.origin!=='http://127.0.0.1'||url.hash||(url.search&&!(url.pathname===base&&url.search==='?footsteps=1')))fail('REFRESH_REQUEST_INVALID');
  if(url.pathname===base)return Response.json(await pinned.anonymous(request.publicationId));
  let m=url.pathname.match(new RegExp(`^${base}/resources/([a-f0-9]{64})$`));let item;
  if(m)item=await pinned.resource(request.publicationId,m[1]);
  else if((m=url.pathname.match(new RegExp(`^${base}/furnishing-notices/([a-f0-9-]{36})$`))))item=await pinned.furnishingNotice(request.publicationId,m[1]);
  else if((m=url.pathname.match(new RegExp(`^${base}/assets/([a-f0-9-]{36})$`))))item=await pinned.asset(request.publicationId,m[1]);
  else fail('REFRESH_REQUEST_INVALID');
  return new Response(item.bytes,{headers:{'content-type':item.mime,'x-exhibitos-publication-revision':item.revisionSha256}});
 };
 const stage=await mkdtemp(join(parent,'.exhibitos-refresh-'));const candidate=join(stage,'candidate');let committed=false;
 try{
  const result=await exportStaticPublication({origin:'http://127.0.0.1',publicationId:request.publicationId,runtimeRoot:join(runtime,'platform/apps/web/dist-static'),output:candidate,fetcher,privateEditor:retainedPrivateEditor(local.entries)});
  if(result.revisionSha256!==request.revisionSha256||result.indexSha256!==request.indexSha256)fail('REFRESH_CONTENT_CHANGED');
  if(cancelled())fail('REFRESH_CANCELLED');
  const generated=JSON.parse(await readFile(join(candidate,'static-export-manifest.json'),'utf8'));
  assertSamePublicationContent(local.entries,generated.files);
  // Revalidate the source at commit, including rights and all source bytes.
  await localStaticPublicationSource(request,{cancelled});await pinned.anonymous(request.publicationId);
  if(cancelled())fail('REFRESH_CANCELLED');
  try{await lstat(output);fail('REFRESH_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  await rename(candidate,output);committed=true;
  let stageCleanup='complete';try{await rm(stage,{recursive:true,force:true});}catch{stageCleanup='pending';}
  return {...result,stageStatus:'verified',output,sourceManifestSha256:request.sourceManifestSha256,targetManifestSha256:request.targetManifestSha256,stageCleanup,stageDirectory:stage};
 }finally{if(!committed)await rm(stage,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let wasCancelled=false;process.on('SIGTERM',()=>{wasCancelled=true;});process.on('SIGINT',()=>{wasCancelled=true;});
 try{let data='';for await(const chunk of process.stdin){data+=chunk;if(Buffer.byteLength(data)>65536)fail('REFRESH_REQUEST_INVALID');}const result=await refreshStaticPublication(JSON.parse(data),{cancelled:()=>wasCancelled});process.stdout.write(JSON.stringify(result)+'\n');}
 catch(e){const code=/^REFRESH_[A-Z_]+$/.test(e.message)?e.message:'REFRESH_FAILED';process.stderr.write(code+'\n');process.exitCode=1;}
}
