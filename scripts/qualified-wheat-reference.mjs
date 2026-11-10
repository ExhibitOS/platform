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
export const R22_REFERENCE=Object.freeze({
 indexSha256:'04033f1f69797b1e6dc0ac39dfb5b0d30dae20df58b74968f0c9e6601543a3b0',
 publicationSha256:'2b3b595067e1a85084bab2148a04aa77851ab887b8ec010b03887f03e7c98d41',
 publicationId:'ce9258bc-a553-4d01-bd73-d59b1fb82c63',
 revisionSha256:'bc58417d00d6c8a07062032ed8f181a4a770640bbd2faa754cc268a2249b48ba',
 assetSha256:WHEAT_REFERENCE.assetSha256,
 candidateId:'e0149040-ee18-4ec2-b2e6-945e82f83239',
});
export const R23_REFERENCE=Object.freeze({
 indexSha256:'7fbb7f2e5ec8a14b55f1c10c52d1c0ddce1d9c2fedb8beb85e5c38b636bae0ed',
 publicationSha256:'f7aa68f6b16f90c837fb7fe9b62d850d232063ab579b08a8b935f7c7b5b0f6ba',
 publicationId:'55dd1571-a2e1-470c-ac5f-79b297347e2d',
 revisionSha256:'971bae6d2bd7bac044f4a80c578021571136e68432f95dc1472fa57e73afe8bc',
 assetSha256:WHEAT_REFERENCE.assetSha256,
 candidateId:'de6908dd-39e9-4dc4-ba85-7a206a39278a',
});
export const R24_REFERENCE=Object.freeze({
 indexSha256:'204169b08b240cc9c4bbae9b14e190ae6c47adff58517182be12fd01b8a66e3f',
 publicationSha256:'6b039f2e128badd5ae82e4657f56255a1e2e1a65ea9fc3b6d376d4b94a68851a',
 publicationId:'645f98fd-edd8-4e83-b66e-e76cf6680c58',
 revisionSha256:'dcb2a94f4539bd79ac37eae15c66cff9cc1f854808cc7c7306e593474156db3f',
 assetSha256:WHEAT_REFERENCE.assetSha256,
 candidateId:'4d8911f0-75b9-4f0a-909c-cbdc8de3c32e',
});
export const R26_REFERENCE=Object.freeze({
 indexSha256:'f65395808f6bc8c75f7b687680e7e881b57ad1f1f75499bae2c81ebbc6bf4fd5',
 publicationSha256:'ea678b4e7360da964c54beade26e00f90bbfc1183e0c534dbcf734a1d2b48a1c',
 publicationId:'81395579-13fa-4875-a25f-83ea0fa0015a',
 revisionSha256:'eb9c9e286a86092dec5b665da742a6bfad95c31445474630907cdcdafefcf7b1',
 assetSha256:WHEAT_REFERENCE.assetSha256,
 candidateId:'752f243b-c5c1-47e1-8124-1f54f7d04299',
});
export const R27_REFERENCE=Object.freeze({
 indexSha256:'2d86b16e1e3a0a2afc266d04341edca688fba6679b1036792d6457728c9a4989',
 publicationSha256:'0ac0efd992d8728a642941ac90b722daee16a6e3f01c8c202f1c96b20f867651',
 publicationId:'ff67a8b5-1fbf-4860-bf19-9bcb229d7468',
 revisionSha256:'387331410ee5516d0e7a3811534487ad8d28b293eaba330925dc19c47928cf49',
 assetSha256:WHEAT_REFERENCE.assetSha256,
 candidateId:'ee5a4365-509e-44f1-8495-30bc5f534eca',
});
export const R41_REFERENCE=Object.freeze({
 indexSha256:'7930f6832341fa943b16820787febd84bc63138179583fe6d2a675cef84da189',
 publicationSha256:'7cb41e36c27978ff33110236c7f4754d605e6f7fc112c84f1b093e5407c22588',
 publicationId:'16029c47-7a21-4a8e-bb39-6821f7bca24d',
 revisionSha256:'d00bfcfb4505e908260a153115a1051c5bdd2cd6438f9bb52c28ff331ecf26b8',
 candidateId:'0cc51666-c6b6-4388-a0ab-6cb799defbf2',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R44_REFERENCE=Object.freeze({
 indexSha256:'866fd62a1ca3babb0f150e8895ce4255cd5c72b0059574f1de3033a8515fd880',
 publicationSha256:'8d864e782fffdd088a066319b29cb364fc9a2fb52758185ee98e2730524b6f29',
 publicationId:'b17be347-1a39-4b10-9a66-fa7f06c310fb',
 revisionSha256:'5eb75fc9fcae3fbd6a322634772f25d6d4400c6cd9fdc9c31e2c902f74602e5f',
 candidateId:'0c3964cb-a8b5-4ee2-afd1-d71cab99ccd7',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R46_REFERENCE=Object.freeze({
 indexSha256:'c3b6ba70e888a20416e40f34a99c328134c122e423b499f3682b0ea896cac17e',
 publicationSha256:'474763f2b2f46b2877f6cd176fcd1351108c4220ba5423c85f08c8c6eb48a2c2',
 publicationId:'e031b101-f8f7-4eb2-88ad-2f4cd900316c',
 revisionSha256:'02420a0e67800e3d957734414f92d99b977c9534172cbd613a8c0ef30f50bd15',
 candidateId:'721829fe-5efc-4024-9d41-293653b11f07',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
const references=new Map([WHEAT_REFERENCE,R19_REFERENCE,R20_REFERENCE,R21_REFERENCE,R22_REFERENCE,R23_REFERENCE,R24_REFERENCE,R26_REFERENCE,R27_REFERENCE,R41_REFERENCE,R44_REFERENCE,R46_REFERENCE].map(reference=>[reference.indexSha256,reference]));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('DEMO_WHEAT_REFERENCE_INVALID');};
const keys=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
async function regular(root,path,limit){
 if(!/^(?:static-publication-index\.json|qualified-(?:wheat|r19|r20|r21|r22|r23|r24|r26|r27|r41|r44|r46)-v4-index\.json|data\/[a-f0-9]{64}\.(?:bin|json))$/.test(path))fail();
 const parts=path.split('/');let p=root;const rootStat=await lstat(p);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail();
 for(const part of parts){p=join(p,part);const st=await lstat(p);if(st.isSymbolicLink())fail();}
 const st=await lstat(p);if(!st.isFile()||st.size<1||st.size>limit)fail();const data=await readFile(p);if(data.length!==st.size)fail();return data;
}
/** Validate pinned v4 bytes, exact original membership and live publication rights. */
export async function verifiedQualifiedWheat({root,indexPath='static-publication-index.json'}){
 const bytes=await regular(root,indexPath,1048576);const reference=references.get(sha(bytes));if(!reference)fail();
 const index=parseStaticJson(bytes);
 const stoolAndLimestone=reference===R26_REFERENCE||reference===R27_REFERENCE||reference===R41_REFERENCE||reference===R44_REFERENCE||reference===R46_REFERENCE;
 const terrazzoFloor=reference===R24_REFERENCE||stoolAndLimestone;
 const charcoalFloor=reference===R23_REFERENCE||terrazzoFloor;
 const upholsteredBench=reference===R22_REFERENCE||charcoalFloor;
 const bench=reference===R21_REFERENCE||upholsteredBench;
 const assetCount=36+Number(bench)+Number(upholsteredBench)+Number(charcoalFloor)+Number(terrazzoFloor)+2*Number(stoolAndLimestone)+2*Number(reference===R46_REFERENCE);
 if(!keys(index,['version','publication','assets','resources','detailAssets',...(bench?['furnishingNotices']:[])])||index.version!==4||!Array.isArray(index.assets)||index.assets.length!==assetCount||!Array.isArray(index.resources)||index.resources.length!==(stoolAndLimestone?8:terrazzoFloor?6:4)||!Array.isArray(index.detailAssets)||index.detailAssets.length!==1)fail();
 const notices=index.furnishingNotices??[];
 if(bench&&(!Array.isArray(notices)||notices.length!==1||
    notices[0]?.sha256!=='aea7aac82234e5f4158a901e84a753b79c75da20b72e859493801dffeaae3de5'||
    !index.assets.some(asset=>asset.sha256==='364f12fc71c4572df5df5ea1b77b4b7c00d77d256459ec1c24657bb92a5c0e2b')))fail();
 if(upholsteredBench&&!index.assets.some(asset=>asset.sha256==='6924041a37702eb8233bf39da973f2235ff951f4b1f31ab564d4ad125542b3de'&&asset.bytes===203064&&asset.mime==='model/gltf-binary'))fail();
 if(charcoalFloor&&!index.assets.some(asset=>asset.sha256==='4684fcb53dbc376f563a7c8bba97d48f660968198401fad0bdff143a14a2f909'&&asset.bytes===2154063&&asset.mime==='image/png'))fail();
 if(terrazzoFloor&&(!index.assets.some(asset=>asset.sha256==='afa5635491e8a7875fe3ca8dfdd6651dc197ab8e648492c98907ec7d07750f90'&&asset.mime==='image/png')||
   !['e77d9970fecdbe384cb6b973ebafea4284a70912eed71ccf88496ec5875ed9b5','865d1556595dfad9278fdd92e2227a8a5decd9e5c34f3d8de2f584e1a012e536'].every(sha256=>index.resources.some(asset=>asset.sha256===sha256&&asset.mime==='image/png'))))fail();
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
 const source=await verifiedQualifiedWheat({root:sourceRoot,indexPath:'qualified-r46-v4-index.json'});
 if(source.reference!==R46_REFERENCE)fail();
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
