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
export const R52_REFERENCE=Object.freeze({
 indexSha256:'eae9524c7d1c1232012b9c3a6d1612288485fa51260a369597802e1c7f3c0b8a',
 publicationSha256:'8685c98477ec9bda7316e98469726734cfe67f7f54a5431c2cea24ce26e34cfc',
 publicationId:'86b7a5c8-2c81-4ffb-8b3d-90316b9b86f8',
 revisionSha256:'abdf3ca07a33d9ad2a9c63a46b640ac2f6b9cac763ba3f19ed57d73c57a25292',
 candidateId:'e91105a5-eb67-4e17-b30a-8791f330ce4b',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R53_REFERENCE=Object.freeze({
 indexSha256:'79541417f1248a4c335c72cdaf9a84906f4558d261782cf0107266bb8f60ce2e',
 publicationSha256:'cdef470d858b51723ae5598e4a648df04a4bdd5ef91f8eaa24fe2ed461ba6de3',
 publicationId:'db270e75-d832-45ee-aa89-26ed9626b68d',
 revisionSha256:'bb4a21f1fa4d5e8a0bc64885b08c06f2a72a346a5a43da86aa81a68583451322',
 candidateId:'0e338503-daec-43a8-bdab-862a2a632180',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R57_REFERENCE=Object.freeze({
 indexSha256:'9ee1a6f7a93288870f130ed2daa0b873bb445fc20192adfd53a1ba1c768141f1',
 publicationSha256:'e99ce99bb99af338430c1f530494a6abac3891d5fae2dd61c5363b7818cd1a6e',
 publicationId:'59b23142-03bd-4d89-9d9b-795dc352557b',
 revisionSha256:'a680f167663d42f850e363bab6b2675745c01f8ca527752a281ce2df5d56cc2f',
 candidateId:'f1782724-50f7-4948-b8c2-e4db2bc16c93',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R61_REFERENCE=Object.freeze({
 indexSha256:'f1da47677f16089aa2d330b1e817a059f2d05f6e853e2f4875dfb34bcb75ecbc',
 publicationSha256:'f5938db6d5ac55f3dc2b440e8188ca267247c31938ac73ee0bebbbefe0ea694c',
 publicationId:'e16e9f49-be31-4540-a34d-f1365d388a4a',
 revisionSha256:'6635e00acf0abd2b6ef1655fba447cdd0957847686ba179d20cfc1c5575a7306',
 candidateId:'5aabeb35-5cbb-464e-9fe7-a9af20190cdf',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R62_REFERENCE=Object.freeze({
 indexSha256:'af0e0722d11ea0549bce2223a6462e69541e3ffb78e8981b26d2ad5f8d8b7f76',
 publicationSha256:'41a63e132e5593d7ba570720f7a6e04970e2f0a3d62fff9631911e60b4d539d1',
 publicationId:'8e4295ec-91b0-43af-94f3-a54a53a2b654',
 revisionSha256:'21310c147a8b9ac0c10ea38c55dbb645750baa454abc11a5434d135c80d666d5',
 candidateId:'c0abf52d-d187-4d1a-86c8-e2c512b3905b',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R64_REFERENCE=Object.freeze({
 indexSha256:'bb653fc24e22844e766a4766740cda40222d8717f9d4bb2274324c7e619cf9ba',
 publicationSha256:'638beb58b18254b69ab4409827a3f2155497d165fc12a71a4d1b62b373d73ff1',
 publicationId:'d50dfccd-121a-454f-921a-724b5958ddd7',
 revisionSha256:'bde439d920ebdb72f917e3ea13fa82e243196535ca53aa713a3ce0b3802a2844',
 candidateId:'906ec075-a63d-4a01-9520-62ce87e39aaf',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R65_REFERENCE=Object.freeze({
 indexSha256:'67a876936034e2e9db73c8986147a9a0e6f65fcf809e01bca43b7c3a4b148f61',
 publicationSha256:'10c673704ddc1435370beeeb863ba619378f0f9990c9f656ff8be8a19f49d967',
 publicationId:'4cd97b13-29d5-4cec-b639-65836991ae79',
 revisionSha256:'1e1688f80e58e37930573f9a2563255ba308af7d8db5218b90266874e86608bb',
 candidateId:'92a75e00-f47d-47ce-b07c-8ddfbd10d1d8',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
export const R67_REFERENCE=Object.freeze({
 indexSha256:'34b014feb03bd3f50f2f1bc51d615d1e7c8f3bc49e7d31c4b8f41f8d89d312f9',
 publicationSha256:'0730095254e1f6501c93bbdbdc6107bb2cf59e882a8f49712ed760b46b7cba46',
 publicationId:'d56e7d66-12e7-4942-850d-d8140311931e',
 revisionSha256:'5f9961a0cc7e699674f4a71e59db156a042a96bf6a840f40994d2d4d47760d3b',
 candidateId:'af6737e3-c558-4ba3-baaa-cfb435477b72',
 assetSha256:WHEAT_REFERENCE.assetSha256,
});
const references=new Map([WHEAT_REFERENCE,R19_REFERENCE,R20_REFERENCE,R21_REFERENCE,R22_REFERENCE,R23_REFERENCE,R24_REFERENCE,R26_REFERENCE,R27_REFERENCE,R41_REFERENCE,R44_REFERENCE,R46_REFERENCE,R52_REFERENCE,R53_REFERENCE,R57_REFERENCE,R61_REFERENCE,R62_REFERENCE,R64_REFERENCE,R65_REFERENCE,R67_REFERENCE].map(reference=>[reference.indexSha256,reference]));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('DEMO_WHEAT_REFERENCE_INVALID');};
const keys=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
async function regular(root,path,limit){
 if(!/^(?:static-publication-index\.json|qualified-(?:wheat|r19|r20|r21|r22|r23|r24|r26|r27|r41|r44|r46|r52|r53|r57|r61|r62|r64|r65|r67)-v4-index\.json|data\/[a-f0-9]{64}\.(?:bin|json))$/.test(path))fail();
 const parts=path.split('/');let p=root;const rootStat=await lstat(p);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail();
 for(const part of parts){p=join(p,part);const st=await lstat(p);if(st.isSymbolicLink())fail();}
 const st=await lstat(p);if(!st.isFile()||st.size<1||st.size>limit)fail();const data=await readFile(p);if(data.length!==st.size)fail();return data;
}
/** Validate pinned v4 bytes, exact original membership and live publication rights. */
export async function verifiedQualifiedWheat({root,indexPath='static-publication-index.json'}){
 const bytes=await regular(root,indexPath,1048576);const reference=references.get(sha(bytes));if(!reference)fail();
 const index=parseStaticJson(bytes);
 const stoolAndLimestone=reference===R26_REFERENCE||reference===R27_REFERENCE||reference===R41_REFERENCE||reference===R44_REFERENCE||reference===R46_REFERENCE||reference===R52_REFERENCE||reference===R53_REFERENCE||reference===R57_REFERENCE||reference===R61_REFERENCE||reference===R62_REFERENCE||reference===R64_REFERENCE||reference===R65_REFERENCE||reference===R67_REFERENCE;
 const terrazzoFloor=reference===R24_REFERENCE||stoolAndLimestone;
 const charcoalFloor=reference===R23_REFERENCE||terrazzoFloor;
 const upholsteredBench=reference===R22_REFERENCE||charcoalFloor;
 const bench=reference===R21_REFERENCE||upholsteredBench;
 const assetCount=36+Number(bench)+Number(upholsteredBench)+Number(charcoalFloor)+Number(terrazzoFloor)+2*Number(stoolAndLimestone)+2*Number(reference===R46_REFERENCE||reference===R52_REFERENCE||reference===R53_REFERENCE||reference===R57_REFERENCE||reference===R61_REFERENCE||reference===R62_REFERENCE||reference===R64_REFERENCE||reference===R65_REFERENCE||reference===R67_REFERENCE)+Number(reference===R61_REFERENCE||reference===R62_REFERENCE||reference===R64_REFERENCE||reference===R65_REFERENCE||reference===R67_REFERENCE)+Number(reference===R64_REFERENCE||reference===R65_REFERENCE||reference===R67_REFERENCE);
 if(!keys(index,['version','publication','assets','resources','detailAssets',...(bench?['furnishingNotices']:[])])||index.version!==4||!Array.isArray(index.assets)||index.assets.length!==assetCount||!Array.isArray(index.resources)||index.resources.length!==(stoolAndLimestone?8:terrazzoFloor?6:4)||!Array.isArray(index.detailAssets)||index.detailAssets.length!==1)fail();
 const notices=index.furnishingNotices??[];
 if(bench&&(!Array.isArray(notices)||notices.length!==1||
    notices[0]?.sha256!=='aea7aac82234e5f4158a901e84a753b79c75da20b72e859493801dffeaae3de5'||
    !index.assets.some(asset=>asset.sha256==='364f12fc71c4572df5df5ea1b77b4b7c00d77d256459ec1c24657bb92a5c0e2b')))fail();
 if(upholsteredBench&&!index.assets.some(asset=>asset.sha256==='6924041a37702eb8233bf39da973f2235ff951f4b1f31ab564d4ad125542b3de'&&asset.bytes===203064&&asset.mime==='model/gltf-binary'))fail();
 if(charcoalFloor&&!index.assets.some(asset=>asset.sha256==='4684fcb53dbc376f563a7c8bba97d48f660968198401fad0bdff143a14a2f909'&&asset.bytes===2154063&&asset.mime==='image/png'))fail();
 if(terrazzoFloor&&(!index.assets.some(asset=>asset.sha256==='afa5635491e8a7875fe3ca8dfdd6651dc197ab8e648492c98907ec7d07750f90'&&asset.mime==='image/png')||
   !['e77d9970fecdbe384cb6b973ebafea4284a70912eed71ccf88496ec5875ed9b5','865d1556595dfad9278fdd92e2227a8a5decd9e5c34f3d8de2f584e1a012e536'].every(sha256=>index.resources.some(asset=>asset.sha256===sha256&&asset.mime==='image/png'))))fail();
 if((reference===R61_REFERENCE||reference===R62_REFERENCE||reference===R64_REFERENCE||reference===R65_REFERENCE||reference===R67_REFERENCE)&&!index.assets.some(asset=>asset.sha256==='4e26824b897af85e781c102cf7f01e404e4266b4d5299088c2b29940facaccba'&&asset.bytes===112044&&asset.mime==='model/gltf-binary'))fail();
 if((reference===R64_REFERENCE||reference===R65_REFERENCE||reference===R67_REFERENCE)&&!index.assets.some(asset=>asset.sha256==='6cb111d9baf50d355c18b8e94b9cff78eeeb9679f02ebf490d7093e2c32c59d0'&&asset.bytes===85876&&asset.mime==='model/gltf-binary'))fail();
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
 const source=await verifiedQualifiedWheat({root:sourceRoot,indexPath:'qualified-r67-v4-index.json'});
 if(source.reference!==R67_REFERENCE)fail();
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
