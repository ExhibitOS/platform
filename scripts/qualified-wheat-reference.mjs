// SPDX-License-Identifier: AGPL-3.0-or-later
// Narrow, immutable Manager-produced reference exhibition. This grants no
// authority to import, publish or export arbitrary original assets.
import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {revisionHash,validateExhibition} from '@exhibitos/spec';
import {parseStaticJson} from '../apps/web/src/static-json.mjs';
import {buildNativeDetailPlan} from './native-detail-plan.mjs';

export const WHEAT_REFERENCE=Object.freeze({
 indexSha256:'8de1650dfcb0e43aafae1f8c181293a0a88fe18c58acd2389c32de0c7bde91a1',
 publicationSha256:'ecf6a63b2a97ae5a08ea996eb342bea7bbfe736a0227fb47df33c0b1635758c9',
 publicationId:'b7cc4bbf-2530-4acf-aa9c-32d733ed4ed2',
 revisionSha256:'41b47f3af2adc536df77a91dcd2918aa527c6343b3b75c31c319b8a0aafe34b8',
 assetSha256:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',
 candidateId:'a05143a1-eb94-48cf-997f-3506b26a16cc',
});
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('DEMO_WHEAT_REFERENCE_INVALID');};
const keys=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
async function regular(root,path,limit){
 if(!/^(?:static-publication-index\.json|qualified-wheat-v4-index\.json|data\/[a-f0-9]{64}\.(?:bin|json))$/.test(path))fail();
 const parts=path.split('/');let p=root;const rootStat=await lstat(p);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail();
 for(const part of parts){p=join(p,part);const st=await lstat(p);if(st.isSymbolicLink())fail();}
 const st=await lstat(p);if(!st.isFile()||st.size<1||st.size>limit)fail();const data=await readFile(p);if(data.length!==st.size)fail();return data;
}
/** Validate pinned v4 bytes, exact original membership and live publication rights. */
export async function verifiedQualifiedWheat({root,indexPath='static-publication-index.json'}){
 const bytes=await regular(root,indexPath,1048576);if(sha(bytes)!==WHEAT_REFERENCE.indexSha256)fail();
 const index=parseStaticJson(bytes);
 if(!keys(index,['version','publication','assets','resources','detailAssets'])||index.version!==4||!Array.isArray(index.assets)||index.assets.length!==32||!Array.isArray(index.resources)||index.resources.length!==4||!Array.isArray(index.detailAssets)||index.detailAssets.length!==1)fail();
 const entries=[index.publication,...index.assets,...index.resources,...index.detailAssets],data=new Map();
 for(const [i,e] of entries.entries()){
  const expectedKeys=i===0?['path','bytes','sha256','mime']:Object.hasOwn(e,'assetId')?['assetId','path','bytes','sha256','mime']:['path','bytes','sha256','mime'];
  if(!keys(e,expectedKeys)||typeof e.sha256!=='string'||! /^[a-f0-9]{64}$/.test(e.sha256)||e.path!==`data/${e.sha256}.${i===0?'json':'bin'}`||!Number.isSafeInteger(e.bytes)||e.bytes<1||e.bytes>(i===0?1048576:25*1024*1024)||typeof e.mime!=='string')fail();
  const content=await regular(root,e.path,e.bytes);if(content.length!==e.bytes||sha(content)!==e.sha256)fail();
  const previous=data.get(e.path);if(previous&&!previous.equals(content))fail();data.set(e.path,content);
 }
 if(index.publication.sha256!==WHEAT_REFERENCE.publicationSha256||index.publication.mime!=='application/json')fail();
 const publication=parseStaticJson(data.get(index.publication.path));
 if(publication.publication?.id!==WHEAT_REFERENCE.publicationId||publication.publication?.status!=='published'||publication.publication?.revisionSha256!==WHEAT_REFERENCE.revisionSha256||revisionHash(publication.exhibition)!==WHEAT_REFERENCE.revisionSha256||!validateExhibition(publication.exhibition,{publicationTime:new Date().toISOString()}).valid)fail();
 const plan=await buildNativeDetailPlan(WHEAT_REFERENCE.publicationId,publication.exhibition,publication.assets,publication.detailAssets);
 if(plan.entries.length!==1||plan.entries[0].sha256!==WHEAT_REFERENCE.assetSha256||plan.entries[0].bytes!==8291194||plan.entries[0].mime!=='image/jpeg'||plan.entries[0].assetId!==index.detailAssets[0].assetId||index.detailAssets[0].sha256!==WHEAT_REFERENCE.assetSha256)fail();
 const candidates=publication.exhibition.artworks.flatMap(a=>(a.extensions?.['org.exhibitos.viewer/artwork-detail-quality']?.candidates??[]).map(candidate=>({candidate,rights:a.rights})));
 if(candidates.length!==1||candidates[0].candidate.candidateId!==WHEAT_REFERENCE.candidateId||!candidates[0].rights?.permissions?.display||!candidates[0].rights?.permissions?.export||!candidates[0].rights?.permissions?.download||candidates[0].rights.licenseId!=='CC0-1.0')fail();
 return {index,bytes,publication,data};
}

/** Reconstruct exact HTML from the trusted runtime templates and verified
 * exhibition; callers compare complete bytes rather than searching for tags. */
export async function expectedWheatHtml({runtimeRoot,exhibition,privateEditor,bases=[]}){
 const template=(await readFile(join(runtimeRoot,'static.html'))).toString('utf8');
 if(template.split('STATIC_INDEX_SHA256').length!==2||template.split('<!--STATIC_COVER_SHELL-->').length!==2||template.split('</head>').length!==2||!/<title>[^<]*<\/title>/.test(template))fail();
 const {renderEntranceShell}=await import('../apps/web/dist-reference-demo-cover/entrance-shell.js');
 const shell=renderEntranceShell(exhibition),title=String(exhibition.title).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let index=template.replace('STATIC_INDEX_SHA256',WHEAT_REFERENCE.indexSha256).replace('<!--STATIC_COVER_SHELL-->',()=>shell).replace(/<title>[^<]*<\/title>/,()=>`<title>${title}</title>`);
 if(privateEditor)index=index.replace('</head>','<meta name="exhibitos-private-editor" content="enabled"></head>');
 let studio;
 if(privateEditor){
  studio=(await readFile(join(runtimeRoot,'static-studio.html'))).toString('utf8');
  if(studio.split('STATIC_INDEX_SHA256').length!==2||studio.split('</head>').length!==2)fail();
  studio=studio.replace('STATIC_INDEX_SHA256',WHEAT_REFERENCE.indexSha256);
  if(bases.length)studio=studio.replace('</head>',`<meta name="exhibitos-private-copy-bases" content='${JSON.stringify(bases)}'></head>`);
 }
 return {index:Buffer.from(index),studio:studio===undefined?undefined:Buffer.from(studio)};
}

/** Rebind a newly created, normal reference-demo staging output to the exact
 * verified native publication. No caller-supplied publication is accepted. */
export async function assembleQualifiedWheat({output,sourceRoot,runtimeRoot,privateEditor}){
 const {readdir,unlink,writeFile}=await import('node:fs/promises');
 const source=await verifiedQualifiedWheat({root:sourceRoot,indexPath:'qualified-wheat-v4-index.json'});
 const manifestPath=join(output,'static-export-manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 const oldIndex=await readFile(join(output,'static-publication-index.json'));const oldHash=sha(oldIndex);
 if(oldHash!=='11ded7c2510a9e77e589bcf10ddffc7ff86ee64fabde586b9aae83975c780d55'||manifest.indexSha256!==oldHash||!Array.isArray(manifest.files))fail();
 const {index:indexHtml}=await expectedWheatHtml({runtimeRoot,exhibition:source.publication.exhibition,privateEditor});
 const studioPath=join(output,'studio.html');let studio;
 if(privateEditor){const original=await readFile(studioPath,'utf8');if(original.split(oldHash).length!==2)fail();studio=Buffer.from(original.replace(oldHash,WHEAT_REFERENCE.indexSha256));}
 // Only the fresh exporter-owned staging directory is changed.
 for(const file of await readdir(join(output,'data'))){if(!/^[a-f0-9]{64}\.(?:bin|json)$/.test(file))fail();await unlink(join(output,'data',file));}
 for(const [path,data] of source.data)await writeFile(join(output,path),data,{flag:'wx'});
 await writeFile(join(output,'static-publication-index.json'),source.bytes);await writeFile(join(output,'index.html'),indexHtml);if(studio)await writeFile(studioPath,studio);
 const entry=(path,b)=>({path,bytes:b.length,sha256:sha(b)});
 manifest.files=manifest.files.filter(x=>!x.path.startsWith('data/')&&!['static-publication-index.json','index.html',...(studio?['studio.html']:[])].includes(x.path));
 manifest.files.push(...[...source.data].map(([path,data])=>entry(path,data)),entry('static-publication-index.json',source.bytes),entry('index.html',indexHtml));if(studio)manifest.files.push(entry('studio.html',studio));
 manifest.files.sort((a,b)=>a.path.localeCompare(b.path));manifest.publicationId=WHEAT_REFERENCE.publicationId;manifest.revisionSha256=WHEAT_REFERENCE.revisionSha256;manifest.indexSha256=WHEAT_REFERENCE.indexSha256;
 await writeFile(manifestPath,JSON.stringify(manifest));
 await verifiedQualifiedWheat({root:output});
}
