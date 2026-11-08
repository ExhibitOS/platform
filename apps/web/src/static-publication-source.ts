import {workspaceFloorMaterials} from './drafts/workspace-material-validation.mjs';
import {publicWorkspaceMaterialRights} from './workspace-material-public-rights.mjs';
import {publicWorkspaceFurnishingRights} from './workspace-furnishing/public-rights.mjs';
import { retainsCopyInventory,retainedWheatCopyFiles } from './private-editor/previous-copy-compatibility';
import { isPreviousWheatV4Index } from './private-editor/previous-wheat-v4.mjs';
import type { PublicPublication,DetailAccess } from "./publication-client";
import {DetailAccessFailure} from './detail-access-failure';
import { freezeCanonical,validateFurnishings,furnishingsFor,WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,ARTWORK_DETAIL_QUALITY_NAMESPACE,verifiedParsedDetailQuality,type WorkspaceFurnishings,type DetailCandidate } from "@exhibitos/studio-contract";
import { newDraft } from "./drafts/example";
import { validateExhibition } from "./drafts/exhibition-validation.mjs";
import { validateDraft } from "./drafts/validator";
import {validFootstepPublication} from './viewer/footstep-publication';
import {validateCoverVariantDescriptor} from './cover-variant-descriptor.mjs';
import {packageFurnishingNoticeManifest} from './vendor/furnishings-v1.mjs';
import {parseStaticJson} from './static-json.mjs';
interface FileEntry {path:string;bytes:number;sha256:string;mime:string;assetId?:string}
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)))].map(x=>x.toString(16).padStart(2,"0")).join("");
async function read(path:string,limit:number,signal?:AbortSignal,cacheEligible=false,base=""){
 if(!/^data\/[a-f0-9]{64}\.(json|bin)$/.test(path)&&path!=="static-publication-index.json")throw Error("STATIC_PATH");
 // Only exact content-addressed paths are read with the normal HTTP cache.
 // The mutable index always bypasses it; each response is still hashed below.
 const response=await fetch(base+"/"+path,{credentials:"omit",cache:cacheEligible?'default':'no-store',signal:signal??AbortSignal.timeout(30000),redirect:"error"});
 if(!response.ok||!response.body)throw Error("STATIC_RESPONSE");const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error("STATIC_SIZE");chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const result=new Uint8Array(length);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}
// Detail capabilities own the complete response, including cancellation. A
// failed cancel remains an error rather than evidence that the reader drained.
class StaticCleanupUncertain extends Error {constructor(cause:unknown){super('STATIC_DETAIL_CLEANUP_UNCERTAIN',{cause});}}
async function awaitCleanup(work:()=>Promise<void>){try{await work();}catch(error){throw new StaticCleanupUncertain(error);}}
async function detailOperation<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if(error instanceof StaticCleanupUncertain)throw new DetailAccessFailure('uncertain',error);throw new DetailAccessFailure('confirmed',error);}}
async function readDetail(path:string,limit:number,signal:AbortSignal,cacheEligible=false){
 if(!/^data\/[a-f0-9]{64}\.bin$/.test(path)&&path!=='static-publication-index.json')throw Error('STATIC_PATH');
 signal.throwIfAborted();const response=await fetch('/'+path,{credentials:'omit',cache:cacheEligible?'default':'no-store',signal,redirect:'error'});
 if(!response.ok||!response.body){if(response.body)await awaitCleanup(()=>response.body!.cancel());throw Error('STATIC_RESPONSE');}
 let bytes:Uint8Array,reader:ReadableStreamDefaultReader<Uint8Array>;try{bytes=new Uint8Array(limit);reader=response.body.getReader();}catch(error){await awaitCleanup(()=>response.body!.cancel());throw error;}let length=0,chunks=0,cancellation:Promise<void>|undefined;
 const cancel=()=>{if(!cancellation){cancellation=Promise.resolve().then(()=>reader.cancel());void cancellation.catch(()=>{});}return cancellation;};
 let active=true,registrationAttempted=false,registrationUncertain=false;const abort=()=>{if(active)void cancel();};
 try{try{registrationAttempted=true;signal.addEventListener('abort',abort,{once:true});}catch(error){registrationUncertain=true;throw error;}if(signal.aborted)abort();for(;;){const next=await reader.read();signal.throwIfAborted();if(next.done)break;if(++chunks>65536||next.value.length===0||next.value.length>limit-length)throw Error('STATIC_SIZE');bytes.set(next.value,length);length+=next.value.length;}signal.throwIfAborted();return bytes.slice(0,length);}
 catch(error){await awaitCleanup(cancel);if(registrationUncertain)throw new StaticCleanupUncertain(error);throw error;}
 // Cleanup uncertainty must override any earlier result.
 // eslint-disable-next-line no-unsafe-finally
 finally{active=false;let removalFailed=false,removalError:unknown;try{if(registrationAttempted)signal.removeEventListener('abort',abort);}catch(error){removalFailed=true;removalError=error;}try{if(cancellation)await awaitCleanup(()=>cancellation!);}finally{try{reader.releaseLock();}catch(error){throw new StaticCleanupUncertain(error);}}if(removalFailed)throw new StaticCleanupUncertain(removalError);}
}
type StaticIndex={version:number;publication:FileEntry;assets:FileEntry[];resources?:FileEntry[];furnishingNotices?:FileEntry[];detailAssets?:FileEntry[]};
type DetailDescriptor={assetId:string;url:string;mime:string};
// Registration remains private to this module and occurs only after the full
// static publication has been verified. A wrapper or another publication may
// not borrow a capability's reader-retirement disposition.
type StaticDetailAttestation=Readonly<{indexSha256:string;publicationSha256:string;candidate:Readonly<{artworkRevisionId:string;sha256:string;bytes:number;mime:string;width:number;height:number}>}>;
const verifiedDetailOwners=new WeakMap<object,{owner:PublicPublication;publication:PublicPublication['publication'];exhibition:PublicPublication['exhibition'];local:NonNullable<PublicPublication['local']>;attestations:ReadonlyMap<string,StaticDetailAttestation>}>();
export function isVerifiedStaticDetailAccess(publication:unknown,access:unknown):access is DetailAccess{
 if(!access||typeof access!=='object')return false;
 try{const binding=verifiedDetailOwners.get(access);if(!binding)return false;const owner=binding.owner;return owner===publication&&owner.publication===binding.publication&&owner.exhibition===binding.exhibition&&owner.local===binding.local&&binding.local.kind==='static'&&binding.local.detailAccess===access;}catch{return false;}
}
/** Attests only the verified loader snapshot; callers must still recheck rights and source before use. */
export function staticDetailAttestation(access:unknown,owner:unknown,candidateId:string):StaticDetailAttestation|undefined{
 if(!isVerifiedStaticDetailAccess(owner,access)||typeof candidateId!=='string')return undefined;
 return verifiedDetailOwners.get(access)?.attestations.get(candidateId);
}
const indexMeta=()=>document.querySelector<HTMLMetaElement>('meta[name="exhibitos-static-index"]')?.content;
async function verifiedIndex(expected:string|undefined,base="",signal?:AbortSignal):Promise<StaticIndex>{
 if(!expected||! /^[a-f0-9]{64}$/.test(expected))throw Error("STATIC_INDEX");
 const bytes=signal&&!base?await readDetail("static-publication-index.json",1048576,signal):await read("static-publication-index.json",1048576,signal,false,base);
 if(await hash(bytes)!==expected)throw Error("STATIC_INDEX_HASH");
 return parseStaticJson(bytes) as StaticIndex;
}
async function loadVerifiedStaticPublication(previousIndex?: string):Promise<{publication:PublicPublication;index:StaticIndex}>{
 const archive=previousIndex&&/^[a-f0-9]{64}$/.test(previousIndex)?`/private-copy-bases/${previousIndex}`:"";
 const expectedIndex=previousIndex??indexMeta();
 const index=await verifiedIndex(expectedIndex,archive);
 if(![1,2,3,4].includes(index.version)||!Array.isArray(index.assets)||index.assets.length>20000||index.version===1&&(index.resources!==undefined||index.furnishingNotices!==undefined)||index.version===2&&(!Array.isArray(index.resources)||index.resources.length>141||index.furnishingNotices!==undefined)||index.version===3&&(!Array.isArray(index.furnishingNotices)||!index.furnishingNotices.length||index.furnishingNotices.length>8||index.resources!==undefined&&(!Array.isArray(index.resources)||index.resources.length>141))||index.version===4&&(!Array.isArray(index.detailAssets)||index.detailAssets.length>16||index.resources!==undefined&&(!Array.isArray(index.resources)||index.resources.length>141)||index.furnishingNotices!==undefined&&(!Array.isArray(index.furnishingNotices)||!index.furnishingNotices.length||index.furnishingNotices.length>8)||Object.keys(index).some(k=>!['version','publication','assets','resources','furnishingNotices','detailAssets'].includes(k))))throw Error("STATIC_INDEX");
 if(!index.publication||! /^[a-f0-9]{64}$/.test(index.publication.sha256)||!Number.isSafeInteger(index.publication.bytes)||index.publication.bytes<1||index.publication.bytes>1048576||index.publication.mime!=='application/json')throw Error("STATIC_INDEX");
 const p=await read(index.publication.path,index.publication.bytes,undefined,!archive&&index.publication.path===`data/${index.publication.sha256}.json`,archive);if(p.length!==index.publication.bytes||await hash(p)!==index.publication.sha256)throw Error("STATIC_PUBLICATION_HASH");
 const value=parseStaticJson(p) as PublicPublication,draft=newDraft();draft.schemaVersion=value.exhibition.schemaVersion;draft.exhibitionId=value.exhibition.id;draft.candidate=value.exhibition;
 if(value.publication.status!=="published"||!validateDraft(draft).valid||!validateFurnishings(value.exhibition).valid||!validFootstepPublication(value)||await hash(new TextEncoder().encode(freezeCanonical(value.exhibition)))!==value.publication.revisionSha256)throw Error("STATIC_PUBLICATION");
 const publicationId=value.publication.id,revisionSha256=value.publication.revisionSha256;
 if(previousIndex&&index.version===4&&!isPreviousWheatV4Index(previousIndex))throw Error('STATIC_PREVIOUS_ASSETS');
 const workspace=value.exhibition.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;if(!validateWorkspaceFurnishings(value.exhibition).valid||!publicWorkspaceFurnishingRights(workspace))throw Error('STATIC_WORKSPACE_FURNISHING');
 const workspaceAssets=workspace?.furnishings??[];
 const material=value.exhibition.extensions?.['org.exhibitos.studio/workspace-materials'];if(!publicWorkspaceMaterialRights(material))throw Error('STATIC_WORKSPACE_MATERIAL');
 const materialAssets=[...new Map(workspaceFloorMaterials(value.exhibition).map(({material:item})=>[item.id,item])).values()];
 const ids=new Set<string>();for(const entry of index.assets){if(!entry.assetId||ids.has(entry.assetId)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>25*1024*1024||! /^[a-f0-9]{64}$/.test(entry.sha256))throw Error("STATIC_ASSET");ids.add(entry.assetId);}
 if(value.assets.length!==ids.size||new Set(value.assets.map(a=>a.assetId)).size!==ids.size||value.assets.some(a=>!index.assets.some(e=>e.assetId===a.assetId&&e.mime===a.mime)||a.url!==`/api/v1/publications/${value.publication.id}/assets/${a.assetId}`))throw Error("STATIC_ASSETS");
 if(workspaceAssets.some(item=>!index.assets.some(entry=>entry.assetId===item.id&&entry.path===`data/${item.model.sha256}.bin`&&entry.bytes===item.model.bytes&&entry.sha256===item.model.sha256&&entry.mime===item.model.mime)||!value.assets.some(asset=>asset.assetId===item.id&&asset.mime===item.model.mime)))throw Error('STATIC_WORKSPACE_FURNISHING');
 if(materialAssets.some(item=>!index.assets.some(entry=>entry.assetId===item.id&&entry.path===`data/${item.maps.color.sha256}.bin`&&entry.bytes===item.maps.color.bytes&&entry.sha256===item.maps.color.sha256&&entry.mime===item.maps.color.mime)||!value.assets.some(asset=>asset.assetId===item.id&&asset.mime===item.maps.color.mime)))throw Error('STATIC_WORKSPACE_MATERIAL');
 if(value.coverVariants&&!validateCoverVariantDescriptor(value))delete value.coverVariants;
 const resources=index.resources??[];if(resources.length!==(value.resources?.length??0)||new Set(resources.map(r=>r.sha256)).size!==resources.length||resources.some(r=>!r||Object.keys(r).sort().join(',')!=='bytes,mime,path,sha256'||r.path!==`data/${r.sha256}.bin`||!value.resources?.some(v=>v.sha256===r.sha256&&v.bytes===r.bytes&&v.mime===r.mime))||Boolean(resources.length)!==(index.version===2||(index.version===3||index.version===4)&&!!value.resources?.length))throw Error('STATIC_RESOURCES');
 const furniture=furnishingsFor(value.exhibition)?.assets??[],expectedNotices=packageFurnishingNoticeManifest(value.exhibition),notices=index.furnishingNotices??[];
 if(index.version!==4&&(index.version===3)!==Boolean(expectedNotices.length)||notices.length!==expectedNotices.length||(value.furnishingNotices?.length??0)!==expectedNotices.length||new Set(notices.map(n=>n.assetId)).size!==notices.length||furniture.some(a=>!value.assets.some(e=>e.assetId===a.id&&e.mime===a.mime)||!index.assets.some(e=>e.assetId===a.id&&e.bytes===a.bytes&&e.sha256===a.sha256&&e.mime===a.mime))||notices.some(n=>{const expected=expectedNotices.find(e=>e.assetId===n.assetId),declared=value.furnishingNotices?.find(e=>e.assetId===n.assetId);return !expected||!declared||Object.keys(n).sort().join(',')!=='assetId,bytes,mime,path,sha256'||n.path!==`data/${n.sha256}.bin`||n.bytes!==expected.bytes||n.sha256!==expected.sha256||n.mime!==expected.mime||Object.keys(declared).sort().join(',')!=='assetId,bytes,mime,sha256,url'||declared.url!==`/api/v1/publications/${value.publication.id}/furnishing-notices/${expected.assetId}`||declared.bytes!==n.bytes||declared.sha256!==n.sha256||declared.mime!==n.mime;}))throw Error('STATIC_FURNISHING');
 const suppliedDescriptors=(value as PublicPublication&{detailAssets?:DetailDescriptor[]}).detailAssets;
 const descriptors=suppliedDescriptors===undefined?undefined:structuredClone(suppliedDescriptors);
 const detailEntries=index.detailAssets??[],detailIds=new Set<string>(),candidateIds=new Set<string>(),detailRights=new Map<string,typeof value.exhibition.artworks[number]['rights']>(),detailCandidates=new Map<string,{candidate:DetailCandidate;artworkRevisionId:string}>();
 if(index.version===4){
  if(!Array.isArray(descriptors)||descriptors.length!==detailEntries.length||Object.keys(value).some(k=>!['publication','exhibition','assets','coverVariants','resources','furnishingNotices','detailAssets'].includes(k))||index.assets.some(e=>!e||Object.keys(e).sort().join(',')!=='assetId,bytes,mime,path,sha256'||e.path!==`data/${e.sha256}.bin`))throw Error('STATIC_DETAIL');
  for(const artwork of value.exhibition.artworks){
   const relation=artwork.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE];if(relation===undefined)continue;
   if(artwork.artworkType!=='image'&&artwork.artworkType!=='sculpture')throw Error('STATIC_DETAIL');
   const verified=await verifiedParsedDetailQuality(relation,artwork.artworkType);if(!verified)throw Error('STATIC_DETAIL');
   for(const candidate of verified.candidates){
    const id=candidate.assetId;if(detailIds.has(id)||candidateIds.has(candidate.candidateId)||[...ids].some(ordinary=>ordinary.toLowerCase()===id))throw Error('STATIC_DETAIL');detailIds.add(id);candidateIds.add(candidate.candidateId);detailRights.set(id,structuredClone(artwork.rights));detailCandidates.set(candidate.candidateId,{candidate,artworkRevisionId:artwork.revisionId});
    const entry=detailEntries.find(e=>e.assetId===id),descriptor=descriptors.find(e=>e.assetId===id);
    if(!entry||Object.keys(entry).sort().join(',')!=='assetId,bytes,mime,path,sha256'||entry.path!==`data/${candidate.sha256}.bin`||entry.sha256!==candidate.sha256||entry.bytes!==candidate.bytes||entry.bytes>25*1024*1024||entry.mime!==candidate.mime||!descriptor||Object.keys(descriptor).sort().join(',')!=='assetId,mime,url'||descriptor.mime!==candidate.mime||descriptor.url!==`/api/v1/publications/${value.publication.id}/detail-assets/${id}`)throw Error('STATIC_DETAIL');
   }
  }
  if(detailIds.size!==detailEntries.length||new Set(detailEntries.map(e=>e.assetId)).size!==detailEntries.length||new Set(descriptors.map(e=>e.assetId)).size!==descriptors.length||detailEntries.reduce((total,e)=>total+e.bytes,0)>100*1024*1024)throw Error('STATIC_DETAIL');
  const paths=new Map<string,{bytes:number;mime:string}>();for(const entry of [...index.assets,...resources,...notices,...detailEntries]){const prior=paths.get(entry.path);if(prior&&(prior.bytes!==entry.bytes||prior.mime!==entry.mime))throw Error('STATIC_DETAIL');paths.set(entry.path,{bytes:entry.bytes,mime:entry.mime});}
 }else if(index.detailAssets!==undefined||descriptors!==undefined||value.exhibition.artworks?.some(a=>a.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE]!==undefined))throw Error('STATIC_DETAIL');
 const fetcher:typeof fetch=async(input,init)=>{const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
 const detailPath=url.startsWith(`/api/v1/publications/${publicationId}/detail-assets/`),detail=detailPath?descriptors?.find(r=>r.url===url):undefined;
 const asset=detailPath?undefined:value.assets.find(a=>a.url===url),resource=detailPath?undefined:value.resources?.find(r=>r.url===url),notice=detailPath?undefined:value.furnishingNotices?.find(r=>r.url===url),entry=detailPath?(detail?detailEntries.find(e=>e.assetId===detail.assetId):undefined):asset?index.assets.find(e=>e.assetId===asset.assetId):resource?resources.find(e=>e.sha256===resource.sha256):notice?notices.find(e=>e.assetId===notice.assetId):undefined;if(!entry||init?.method&&init.method!=="GET")throw Error("STATIC_ASSET_URL");
 const workspaceAsset=!!asset&&(workspaceAssets.some(item=>item.id===asset.assetId)||materialAssets.some(item=>item.id===asset.assetId));
 if(resource||notice||workspaceAsset||detail)await check();
 if(detail)checkDetailRights(detail.assetId);
 const data=await read(entry.path,entry.bytes,init?.signal??undefined,entry.path===`data/${entry.sha256}.bin`);if(data.length!==entry.bytes||await hash(data)!==entry.sha256)throw Error("STATIC_ASSET_HASH");
 if(resource||notice||workspaceAsset||detail)await check();
 if(detail)checkDetailRights(detail.assetId);
 return new Response(new Uint8Array(data),{headers:{"content-type":entry.mime,"content-length":String(data.length),"x-exhibitos-publication-revision":revisionSha256}});};
 const check=async()=>{if(!validateExhibition(value.exhibition,{publicationTime:new Date().toISOString()}).valid||!publicWorkspaceFurnishingRights(workspace)||!publicWorkspaceMaterialRights(material))throw Error("STATIC_DISPLAY_RIGHTS");};await check();
 const checkDetailRights=(id:string)=>{const rights=detailRights.get(id),from=rights?.validFrom===undefined?-Infinity:Date.parse(rights.validFrom);if(!rights||Number.isNaN(from)||rights.expiresAt!==undefined||!rights.permissions.display||!rights.permissions.export||!rights.permissions.download||Date.now()<from)throw Error('STATIC_DETAIL_RIGHTS');};
 const recheckDetail=async(candidateId:string,signal:AbortSignal)=>{signal.throwIfAborted();const bound=detailCandidates.get(candidateId);if(!bound)throw Error('STATIC_DETAIL');await verifiedIndex(expectedIndex,'',signal);signal.throwIfAborted();const canonical=freezeCanonical(value.exhibition);if(value.publication.id!==publicationId||value.publication.revisionSha256!==revisionSha256||value.publication.status!=='published'||await hash(new TextEncoder().encode(canonical))!==revisionSha256)throw Error('STATIC_PUBLICATION');await check();checkDetailRights(bound.candidate.assetId);signal.throwIfAborted();if(freezeCanonical(value.exhibition)!==canonical||value.publication.id!==publicationId||value.publication.revisionSha256!==revisionSha256||value.publication.status!=='published')throw Error('STATIC_PUBLICATION');};
 const detailAccess:DetailAccess|undefined=index.version===4&&!previousIndex?Object.freeze({revisionSha256,candidatesFor(artworkRevisionId:string,signal=AbortSignal.timeout(30000)){return detailOperation(async()=>{signal.throwIfAborted();const candidates=[...detailCandidates.values()].filter(item=>item.artworkRevisionId===artworkRevisionId).map(item=>item.candidate);if(candidates[0])await recheckDetail(candidates[0].candidateId,signal);for(const candidate of candidates)checkDetailRights(candidate.assetId);signal.throwIfAborted();return Object.freeze(candidates);});},recheck(candidateId:string,signal:AbortSignal){return detailOperation(()=>recheckDetail(candidateId,signal));},fetch(candidateId:string,signal:AbortSignal){return detailOperation(async()=>{await recheckDetail(candidateId,signal);const bound=detailCandidates.get(candidateId)!,entry=detailEntries.find(item=>item.assetId===bound.candidate.assetId)!;const bytes=await readDetail(entry.path,entry.bytes,signal,true);if(bytes.length!==entry.bytes||await hash(bytes)!==entry.sha256)throw Error('STATIC_ASSET_HASH');await recheckDetail(candidateId,signal);return bytes;});}}):undefined;
 if(previousIndex){
  // The current publication must itself pass its normal validation before it
  // can authorize exact historical Wheat bytes absent from its inventory.
  const active=await loadVerifiedStaticPublication(),activeIndex=active.index,supplemental:FileEntry[]=[];
  if(index.version===4){
   // The exact previously public original must still be present in the
   // independently validated active publication and at its hashed path.
   const old=detailEntries[0];
   if(activeIndex.version!==4||detailEntries.length!==1||!old||!activeIndex.detailAssets?.some(e=>e.path===old.path&&e.sha256===old.sha256&&e.bytes===old.bytes&&e.mime===old.mime))throw Error('STATIC_PREVIOUS_ASSETS');
   const access=active.publication.local?.detailAccess;let authorized=false;
   if(!access)throw Error('STATIC_PREVIOUS_ASSETS');
   for(const artwork of active.publication.exhibition.artworks){const candidates=await access.candidatesFor(artwork.revisionId);if(candidates.some(c=>c.sha256===old.sha256&&c.bytes===old.bytes&&c.mime===old.mime))authorized=true;}
   if(!authorized)throw Error('STATIC_PREVIOUS_ASSETS');
   const bytes=await read(old.path,old.bytes,undefined,true);if(bytes.length!==old.bytes||await hash(bytes)!==old.sha256)throw Error('STATIC_PREVIOUS_ASSETS');
  }
  for(const file of retainedWheatCopyFiles(value.exhibition,active.publication.exhibition)){
   const same=(entry:FileEntry)=>entry.path===file.path&&entry.sha256===file.sha256&&entry.bytes===file.bytes&&entry.mime===file.mime;
   if(!index.assets.some(same)||activeIndex.assets.some(same))continue;
   const bytes=await read(file.path,file.bytes,undefined,true);if(bytes.length!==file.bytes||await hash(bytes)!==file.sha256)throw Error('STATIC_PREVIOUS_ASSETS');supplemental.push(file);
  }
  if(!retainsCopyInventory(index,{...activeIndex,assets:[...activeIndex.assets,...supplemental]},activeIndex.version===4))throw Error('STATIC_PREVIOUS_ASSETS');
 }
 const publication:PublicPublication={...value,local:{kind:"static",verifiedIndexSha256:expectedIndex!,fetcher,check,...(detailAccess?{detailAccess}:{})}};if(detailAccess){const attestations=new Map<string,StaticDetailAttestation>();for(const {candidate,artworkRevisionId} of detailCandidates.values()){const media=candidate.featureReport.media;if(media.kind==='image')attestations.set(candidate.candidateId,Object.freeze({indexSha256:expectedIndex!,publicationSha256:index.publication.sha256,candidate:Object.freeze({artworkRevisionId,sha256:candidate.sha256,bytes:candidate.bytes,mime:candidate.mime,width:media.width,height:media.height})}));}verifiedDetailOwners.set(detailAccess,{owner:publication,publication:publication.publication,exhibition:publication.exhibition,local:publication.local!,attestations});}
 return {publication,index};
}
export async function loadStaticPublication(previousIndex?:string):Promise<PublicPublication>{return (await loadVerifiedStaticPublication(previousIndex)).publication;}
