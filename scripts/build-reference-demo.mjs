// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile,lstat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

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

export async function exportReferenceDemo({runtimeRoot=join(root,'apps/web/dist-static'),output=join(root,'dist-demo')}={}){
 const {createPagesPublicationSource}=await import('./pages-publication-source.mjs');
 const {exportStaticPublication}=await import('./export-static-publication.mjs');
 const pinned=JSON.parse(await readFile(join(root,'demos/reference-exhibition/publication.json'),'utf8'));
 const source=createPagesPublicationSource({origin:sourceOrigin,...pinned,fetch:localPublicationFetch(join(root,'demos/reference-exhibition/source'))});
 return exportStaticPublication({origin:'http://127.0.0.1',publicationId:pinned.publicationId,runtimeRoot,output,fetcher:async input=>{
  const url=new URL(input),base=`/api/v1/publications/${pinned.publicationId}`;
  if(url.origin!=='http://127.0.0.1'||url.search||url.hash)throw Error('DEMO_EXPORT_PATH');
  if(url.pathname===base)return Response.json(await source.anonymous(pinned.publicationId));
  const match=url.pathname.match(new RegExp(`^${base}/assets/([a-f0-9-]{36})$`));
  if(!match)throw Error('DEMO_EXPORT_PATH');
  const asset=await source.asset(pinned.publicationId,match[1]);
  return new Response(asset.bytes,{headers:{'content-type':asset.mime,'x-exhibitos-publication-revision':asset.revisionSha256}});
 }});
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
 for(const workspace of ['@exhibitos/studio-contract','@exhibitos/storage','@exhibitos/api'])await run([npm,'run','build','--workspace',workspace]);
 await run(['scripts/build-web-schema-validators.mjs','--check']);
 await run([join(root,'node_modules/vite/bin/vite.js'),'build','--config','vite.static.config.ts'],{cwd:join(root,'apps/web'),env:{...process.env,EXHIBITOS_STATIC_TARGET:'viewer'}});
 console.log(JSON.stringify(await exportReferenceDemo()));
}
