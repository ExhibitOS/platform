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
 indexSha256:'50888213fc0ccbf37164ff0a1b14fc21c7bb8443aaab4a292e211efaae97a726',
 publicationSha256:'f66ff2b453125df5a6a69c3b893f0c9ca46b752d743a753943b4e0a16ec75e7b',
 publicationId:'946b312b-88b5-4920-977c-4db47b4e4a3f',
 revisionSha256:'1b9cbad79b1e561b82a56b236cabc9c270500406bb40966b62636e018985748d',
 assetSha256:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',
 candidateId:'725097fe-56b5-4fb6-9a21-05170171fd0a',
});
export const R19_REFERENCE=Object.freeze({
 indexSha256:'af7e1967477a9b1d247da21bc27b894561c74da1f0d2614b7b29443fa4975d5d',
 publicationSha256:'009511e3133cc8c89ca0237cb55fed0043df9967dc7f0914c4fe165653f74aff',
 publicationId:'6fa99da3-ebc3-4cd7-bd67-58ac822bb2a4',
 revisionSha256:'be7e7511319007e510e24a511acb709d52d45417f9378ff50508464dce54ffbe',
 assetSha256:WHEAT_REFERENCE.assetSha256,
 candidateId:'bbd79da8-830c-4356-bf49-af131de40ba6',
});
export const R20_REFERENCE=Object.freeze({
 indexSha256:'054b6756a6aa468e25eaa634b84800fb01d3b21d11f0fff6075f5d54291e8d68',
 publicationSha256:'b1f966765930533fd4ee649ca33961fea8db6a132ad3ce3ea95e5bb74d57a547',
 publicationId:'19e2ce1b-c237-478e-a11c-47c34ee80adc',
 revisionSha256:'6936b3910f1ed1b55b3193f8432d178080e5a9fe7d6217e741f345c83dde68f3',
 assetSha256:WHEAT_REFERENCE.assetSha256,
 candidateId:'af6bd1f4-cc9b-4cee-bb0c-cdfc1626173f',
});
export const R21_REFERENCE=Object.freeze({
 indexSha256:'5664e9e067b68854760097b03c527dd7653e5a2819075bff794a9cc8a6cc0e7b',
 publicationSha256:'49421cbc69c017f5811039a0ba43b58adf00704de70156a2d2347ad0cb18c580',
 publicationId:'805bb7f5-4415-43bf-8572-9b766db29bd2',
 revisionSha256:'585d9e49d84aeb89fc992cb9ffe48543caa321c311260d8f73865c70d7ec0d48',
 assetSha256:WHEAT_REFERENCE.assetSha256,
 candidateId:'ce3f1da0-dc01-4921-8bc0-75640ac13969',
});
const references=new Map([WHEAT_REFERENCE,R19_REFERENCE,R20_REFERENCE,R21_REFERENCE].map(reference=>[reference.indexSha256,reference]));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('DEMO_WHEAT_REFERENCE_INVALID');};
const keys=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
async function regular(root,path,limit){
 if(!/^(?:static-publication-index\.json|qualified-(?:wheat|r19|r20|r21)-v4-index\.json|data\/[a-f0-9]{64}\.(?:bin|json))$/.test(path))fail();
 const parts=path.split('/');let p=root;const rootStat=await lstat(p);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail();
 for(const part of parts){p=join(p,part);const st=await lstat(p);if(st.isSymbolicLink())fail();}
 const st=await lstat(p);if(!st.isFile()||st.size<1||st.size>limit)fail();const data=await readFile(p);if(data.length!==st.size)fail();return data;
}
/** Validate pinned v4 bytes, exact original membership and live publication rights. */
export async function verifiedQualifiedWheat({root,indexPath='static-publication-index.json'}){
 const bytes=await regular(root,indexPath,1048576);const reference=references.get(sha(bytes));if(!reference)fail();
 const index=parseStaticJson(bytes);
 const bench=reference===R21_REFERENCE;
 if(!keys(index,['version','publication','assets','resources','detailAssets',...(bench?['furnishingNotices']:[])])||index.version!==4||!Array.isArray(index.assets)||index.assets.length!==(bench?37:36)||!Array.isArray(index.resources)||index.resources.length!==4||!Array.isArray(index.detailAssets)||index.detailAssets.length!==1)fail();
 const notices=index.furnishingNotices??[];
 if(bench&&(!Array.isArray(notices)||notices.length!==1||
    notices[0]?.sha256!=='aea7aac82234e5f4158a901e84a753b79c75da20b72e859493801dffeaae3de5'||
    !index.assets.some(asset=>asset.sha256==='364f12fc71c4572df5df5ea1b77b4b7c00d77d256459ec1c24657bb92a5c0e2b')))fail();
 const entries=[index.publication,...index.assets,...index.resources,...notices,...index.detailAssets],data=new Map();
 for(const [i,e] of entries.entries()){
  const expectedKeys=i===0?['path','bytes','sha256','mime']:Object.hasOwn(e,'assetId')?['assetId','path','bytes','sha256','mime']:['path','bytes','sha256','mime'];
  if(!keys(e,expectedKeys)||typeof e.sha256!=='string'||! /^[a-f0-9]{64}$/.test(e.sha256)||e.path!==`data/${e.sha256}.${i===0?'json':'bin'}`||!Number.isSafeInteger(e.bytes)||e.bytes<1||e.bytes>(i===0?1048576:25*1024*1024)||typeof e.mime!=='string')fail();
  const content=await regular(root,e.path,e.bytes);if(content.length!==e.bytes||sha(content)!==e.sha256)fail();
  const previous=data.get(e.path);if(previous&&!previous.equals(content))fail();data.set(e.path,content);
 }
 if(index.publication.sha256!==reference.publicationSha256||index.publication.mime!=='application/json')fail();
 const publication=parseStaticJson(data.get(index.publication.path));
 if(publication.publication?.id!==reference.publicationId||publication.publication?.status!=='published'||publication.publication?.revisionSha256!==reference.revisionSha256||revisionHash(publication.exhibition)!==reference.revisionSha256||!validateExhibition(publication.exhibition,{publicationTime:new Date().toISOString()}).valid)fail();
 const plan=await buildNativeDetailPlan(reference.publicationId,publication.exhibition,publication.assets,publication.detailAssets);
 if(plan.entries.length!==1||plan.entries[0].sha256!==reference.assetSha256||plan.entries[0].bytes!==8291194||plan.entries[0].mime!=='image/jpeg'||plan.entries[0].assetId!==index.detailAssets[0].assetId||index.detailAssets[0].sha256!==reference.assetSha256)fail();
 const candidates=publication.exhibition.artworks.flatMap(a=>(a.extensions?.['org.exhibitos.viewer/artwork-detail-quality']?.candidates??[]).map(candidate=>({candidate,rights:a.rights})));
 if(candidates.length!==1||candidates[0].candidate.candidateId!==reference.candidateId||!candidates[0].rights?.permissions?.display||!candidates[0].rights?.permissions?.export||!candidates[0].rights?.permissions?.download||candidates[0].rights.licenseId!=='CC0-1.0')fail();
 return {index,bytes,publication,data,reference};
}

/** Reconstruct exact HTML from the trusted runtime templates and verified
 * exhibition; callers compare complete bytes rather than searching for tags. */
export async function expectedWheatHtml({runtimeRoot,exhibition,privateEditor,indexSha256=WHEAT_REFERENCE.indexSha256}){
 const template=(await readFile(join(runtimeRoot,'static.html'))).toString('utf8');
 if(template.split('STATIC_INDEX_SHA256').length!==2||template.split('<!--STATIC_COVER_SHELL-->').length!==2||template.split('</head>').length!==2||!/<title>[^<]*<\/title>/.test(template))fail();
 const {renderEntranceShell}=await import('../apps/web/dist-reference-demo-cover/entrance-shell.js');
 const shell=renderEntranceShell(exhibition),title=String(exhibition.title).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let index=template.replace('STATIC_INDEX_SHA256',indexSha256).replace('<!--STATIC_COVER_SHELL-->',()=>shell).replace(/<title>[^<]*<\/title>/,()=>`<title>${title}</title>`);
 const decorationMode='<meta name="exhibitos-demo-decoration" content="session-v1">';
 if(privateEditor)index=index.replace('</head>','<meta name="exhibitos-private-editor" content="enabled">'+decorationMode+'</head>');
 let studio;
 if(privateEditor){
  studio=(await readFile(join(runtimeRoot,'static-studio.html'))).toString('utf8');
  if(studio.split('STATIC_INDEX_SHA256').length!==2||studio.split('</head>').length!==2)fail();
  studio=studio.replace('STATIC_INDEX_SHA256',indexSha256).replace('</head>',decorationMode+'</head>');
 }
 return {index:Buffer.from(index),studio:studio===undefined?undefined:Buffer.from(studio)};
}

/** Rebind a newly created, normal reference-demo staging output to the exact
 * verified native publication. No caller-supplied publication is accepted. */
export async function assembleQualifiedWheat({output,sourceRoot,runtimeRoot,privateEditor}){
 const {readdir,unlink,writeFile}=await import('node:fs/promises');
 const source=await verifiedQualifiedWheat({root:sourceRoot,indexPath:'qualified-r21-v4-index.json'});
 if(source.reference!==R21_REFERENCE)fail();
 const manifestPath=join(output,'static-export-manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 const oldIndex=await readFile(join(output,'static-publication-index.json'));const oldHash=sha(oldIndex);
 if(oldHash!=='11ded7c2510a9e77e589bcf10ddffc7ff86ee64fabde586b9aae83975c780d55'||manifest.indexSha256!==oldHash||!Array.isArray(manifest.files))fail();
 const {index:indexHtml,studio}=await expectedWheatHtml({runtimeRoot,exhibition:source.publication.exhibition,privateEditor,indexSha256:source.reference.indexSha256});
 const studioPath=join(output,'studio.html');
 if(privateEditor&&(await readFile(studioPath,'utf8')).split(oldHash).length!==2)fail();
 // Only the fresh exporter-owned staging directory is changed.
 for(const file of await readdir(join(output,'data'))){if(!/^[a-f0-9]{64}\.(?:bin|json)$/.test(file))fail();await unlink(join(output,'data',file));}
 for(const [path,data] of source.data)await writeFile(join(output,path),data,{flag:'wx'});
 await writeFile(join(output,'static-publication-index.json'),source.bytes);await writeFile(join(output,'index.html'),indexHtml);if(studio)await writeFile(studioPath,studio);
 const entry=(path,b)=>({path,bytes:b.length,sha256:sha(b)});
 manifest.files=manifest.files.filter(x=>!x.path.startsWith('data/')&&!['static-publication-index.json','index.html',...(studio?['studio.html']:[])].includes(x.path));
 manifest.files.push(...[...source.data].map(([path,data])=>entry(path,data)),entry('static-publication-index.json',source.bytes),entry('index.html',indexHtml));if(studio)manifest.files.push(entry('studio.html',studio));
 manifest.files.sort((a,b)=>a.path.localeCompare(b.path));manifest.publicationId=source.reference.publicationId;manifest.revisionSha256=source.reference.revisionSha256;manifest.indexSha256=source.reference.indexSha256;
 await writeFile(manifestPath,JSON.stringify(manifest));
 await verifiedQualifiedWheat({root:output});
}
