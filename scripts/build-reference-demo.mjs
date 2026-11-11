// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile,lstat,writeFile,mkdtemp,rename,rm,open,unlink} from 'node:fs/promises';
import {resolve,dirname,join,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {staticCacheHeaders,STATIC_CACHE_POLICY_VERSION} from './static-cache-policy.mjs';

import {readApprovedCopyBases,writeCopyBases} from './reference-demo-copy-bases.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourceOrigin='https://reference-demo.invalid';

/** Serve only the pinned public publication inputs; never fall back to the network. */
export function localPublicationFetch(sourceRoot){
 return async input=>{
  const url=new URL(input);
  if(url.origin!==sourceOrigin||url.search||url.hash||!/^\/(?:static-publication-index\.json|data\/[a-f0-9]{64}\.(?:json|bin))$/.test(url.pathname))throw Error('DEMO_SOURCE_PATH');
  const path=join(sourceRoot,url.pathname.slice(1));
  // The directory and input must both be ordinary repository files, not links.
  for(const part of [sourceRoot,...(url.pathname.startsWith('/data/')?[join(sourceRoot,'data')]:[]),path]){
   if((await lstat(part)).isSymbolicLink())throw Error('DEMO_SOURCE_SYMLINK');
  }
  const stat=await lstat(path);
  if(!stat.isFile()||stat.size>25*1024*1024)throw Error('DEMO_SOURCE_FILE');
  return new Response(await readFile(path));
 };
}

async function exportReferenceDemoStage({runtimeRoot,output,privateEditor,coverCompanion,qualifiedSourceRoot}){
 const {createPagesPublicationSource}=await import('./pages-publication-source.mjs');
 const {exportStaticPublication}=await import('./export-static-publication.mjs');
 const pinned=JSON.parse(await readFile(join(root,'demos/reference-exhibition/publication.json'),'utf8'));
 const source=createPagesPublicationSource({origin:sourceOrigin,...pinned,contract:coverCompanion,fetch:localPublicationFetch(join(root,'demos/reference-exhibition/source'))});
 const result=await exportStaticPublication({origin:'http://127.0.0.1',publicationId:pinned.publicationId,runtimeRoot,output,privateEditor,coverCompanion,fetcher:async input=>{
  const url=new URL(input),base=`/api/v1/publications/${pinned.publicationId}`;
  if(url.origin!=='http://127.0.0.1'||url.hash||(url.search&&!(url.pathname===base&&url.search==='?footsteps=1')))throw Error('DEMO_EXPORT_PATH');
  if(url.pathname===base)return Response.json(await source.anonymous(pinned.publicationId));
  const resource=url.pathname.match(new RegExp(`^${base}/resources/([a-f0-9]{64})$`));
  if(resource){const item=await source.resource(pinned.publicationId,resource[1]);return new Response(item.bytes,{headers:{'content-type':item.mime,'x-exhibitos-publication-revision':item.revisionSha256}});}
  const notice=url.pathname.match(new RegExp(`^${base}/furnishing-notices/([a-f0-9-]{36})$`));
  if(notice){const item=await source.furnishingNotice(pinned.publicationId,notice[1]);return new Response(item.bytes,{headers:{'content-type':item.mime,'x-exhibitos-publication-revision':item.revisionSha256}});}
  const match=url.pathname.match(new RegExp(`^${base}/assets/([a-f0-9-]{36})$`));
  if(!match)throw Error('DEMO_EXPORT_PATH');
  const asset=await source.asset(pinned.publicationId,match[1]);
  return new Response(asset.bytes,{headers:{'content-type':asset.mime,'x-exhibitos-publication-revision':asset.revisionSha256}});
 }});
 // Wrangler control file is created only by this trusted deployment wrapper;
 // the normal exported artifact remains suitable for Manager's strict importer.
 const demoRoot=join(root,'demos/reference-exhibition');
 if(coverCompanion==='reference-demo'){
  const {assembleQualifiedWheat}=await import('./qualified-wheat-reference.mjs');
  await assembleQualifiedWheat({output:result.output,sourceRoot:qualifiedSourceRoot??join(demoRoot,'source'),runtimeRoot,privateEditor,...(qualifiedSourceRoot?{indexPath:'static-publication-index.json'}:{})});
 }else{
  const bases=await readApprovedCopyBases(join(demoRoot,'previous-copy-bases.json'));
  if(bases.length&&!privateEditor)throw Error('DEMO_COPY_BASE');
  await writeCopyBases(result.output,demoRoot,bases);
 }
 const manifestBytes=await readFile(join(result.output,'static-export-manifest.json'));
 const manifest=JSON.parse(manifestBytes);
 const index=JSON.parse(await readFile(join(result.output,'static-publication-index.json'),'utf8'));
 const headers=staticCacheHeaders(index,manifest.files);if(headers)await writeFile(join(result.output,'_headers'),headers,{flag:'wx',mode:0o600});
 return {...result,publicationId:index.version===4?JSON.parse(await readFile(join(result.output,index.publication.path),'utf8')).publication.id:result.publicationId,revisionSha256:index.version===4?JSON.parse(await readFile(join(result.output,index.publication.path),'utf8')).publication.revisionSha256:result.revisionSha256,indexSha256:createHash('sha256').update(await readFile(join(result.output,'static-publication-index.json'))).digest('hex'),manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),files:manifest.files.length+1,bytes:manifest.files.reduce((sum,file)=>sum+file.bytes,manifestBytes.length),cachePolicy:STATIC_CACHE_POLICY_VERSION,cachePolicySha256:createHash('sha256').update(headers).digest('hex')};
}


/** Build and inspect in an owned sibling directory before publishing output. */
export async function exportReferenceDemo({runtimeRoot=join(root,'apps/web/dist-static'),output=join(root,'dist-demo'),privateEditor=false,coverCompanion='native',qualifiedSourceRoot}={}){
 if(coverCompanion!=='reference-demo')return exportReferenceDemoStage({runtimeRoot,output,privateEditor,coverCompanion,qualifiedSourceRoot});
 const target=resolve(output),lockPath=join(dirname(target),`.${basename(target)}.reference-build.lock`);
 // Cooperating reference-demo writers must hold this exclusive sibling lock.
 const lock=await open(lockPath,'wx',0o600);let stage;
 try{
  try{await lstat(target);throw Error('DEMO_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  stage=await mkdtemp(join(dirname(target),'.reference-demo-'));const candidate=join(stage,'output');
  const result=await exportReferenceDemoStage({runtimeRoot,output:candidate,privateEditor,coverCompanion,qualifiedSourceRoot});
  const {inspectDemo}=await import('./deploy-reference-demo.mjs');
  await inspectDemo({output:candidate,pin:result.indexSha256,commit:'local-build',runtimeRoot});
  try{await lstat(target);throw Error('DEMO_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  await rename(candidate,target);return {...result,output:target};
 }finally{if(stage)await rm(stage,{recursive:true,force:true});await lock.close();await unlink(lockPath);}

}

async function run(args,options={}){
 await new Promise((ok,reject)=>{
  const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',...options});
  child.once('error',reject);child.once('exit',(code,signal)=>code===0?ok():reject(Error(`DEMO_BUILD_FAILED ${code??signal}`)));
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==2)throw Error('Usage: npm run build:reference-demo');
 if(process.versions.node!=='24.21.0')throw Error('DEMO_NODE_VERSION');
 if(!process.env.npm_config_user_agent?.startsWith('npm/11.19.0 '))throw Error('DEMO_NPM_VERSION');
 const npm=process.env.npm_execpath;
 if(!npm)throw Error('Run with npm run build:reference-demo');
 await run([npm,'run','notices']);
 for(const workspace of ['@exhibitos/studio-contract','@exhibitos/storage'])await run([npm,'run','build','--workspace',workspace]);
 await run([npm,'run','build:public-export','--workspace','@exhibitos/api']);
 await run(['scripts/build-web-schema-validators.mjs','--check']);
 await run([join(root,'node_modules/vite/bin/vite.js'),'build','--config','vite.static.config.ts','--outDir','dist-reference-demo-static'],{cwd:join(root,'apps/web'),env:{...process.env,EXHIBITOS_STATIC_TARGET:'viewer',EXHIBITOS_PRIVATE_EDITOR:'1'}});
 await run([join(root,'node_modules/vite/bin/vite.js'),'build','--config','vite.cover.config.ts','--outDir','dist-reference-demo-cover'],{cwd:join(root,'apps/web')});
 console.log(JSON.stringify(await exportReferenceDemo({runtimeRoot:join(root,'apps/web/dist-reference-demo-static'),privateEditor:true,coverCompanion:'reference-demo',...(process.env.EXHIBITOS_QUALIFIED_REFERENCE_SOURCE?{qualifiedSourceRoot:resolve(process.env.EXHIBITOS_QUALIFIED_REFERENCE_SOURCE)}:{})})));
}
