import {workspaceFloorMaterials} from './drafts/workspace-material-validation.mjs';
import {publicWorkspaceMaterialRights} from './workspace-material-public-rights.mjs';
import {publicWorkspaceFurnishingRights} from './workspace-furnishing/public-rights.mjs';
import { retainsCopyInventory } from './private-editor/previous-copy-compatibility';
import type { PublicPublication } from "./publication-client";
import { freezeCanonical,validateFurnishings,furnishingsFor,WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings } from "@exhibitos/studio-contract";
import { newDraft } from "./drafts/example";
import { validateExhibition } from "./drafts/exhibition-validation.mjs";
import { validateDraft } from "./drafts/validator";
import {validFootstepPublication} from './viewer/footstep-publication';
import {validateCoverVariantDescriptor} from './cover-variant-descriptor.mjs';
import {packageFurnishingNoticeManifest} from './vendor/furnishings-v1.mjs';
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
type StaticIndex={version:number;publication:FileEntry;assets:FileEntry[];resources?:FileEntry[];furnishingNotices?:FileEntry[]};
const indexMeta=()=>document.querySelector<HTMLMetaElement>('meta[name="exhibitos-static-index"]')?.content;
async function verifiedIndex(expected:string|undefined,base=""):Promise<StaticIndex>{
 if(!expected||! /^[a-f0-9]{64}$/.test(expected))throw Error("STATIC_INDEX");
 const bytes=await read("static-publication-index.json",1048576,undefined,false,base);
 if(await hash(bytes)!==expected)throw Error("STATIC_INDEX_HASH");
 return JSON.parse(new TextDecoder().decode(bytes)) as StaticIndex;
}
export async function loadStaticPublication(previousIndex?: string):Promise<PublicPublication>{
 const archive=previousIndex&&/^[a-f0-9]{64}$/.test(previousIndex)?`/private-copy-bases/${previousIndex}`:"";
 const index=await verifiedIndex(previousIndex??indexMeta(),archive);
 if(previousIndex&&!retainsCopyInventory(index,await verifiedIndex(indexMeta())))throw Error("STATIC_PREVIOUS_ASSETS");
 if(![1,2,3].includes(index.version)||!Array.isArray(index.assets)||index.assets.length>20000||index.version===1&&(index.resources!==undefined||index.furnishingNotices!==undefined)||index.version===2&&(!Array.isArray(index.resources)||index.resources.length>141||index.furnishingNotices!==undefined)||index.version===3&&(!Array.isArray(index.furnishingNotices)||!index.furnishingNotices.length||index.furnishingNotices.length>8||index.resources!==undefined&&(!Array.isArray(index.resources)||index.resources.length>141)))throw Error("STATIC_INDEX");
 if(!index.publication||! /^[a-f0-9]{64}$/.test(index.publication.sha256)||!Number.isSafeInteger(index.publication.bytes)||index.publication.bytes<1||index.publication.bytes>1048576||index.publication.mime!=='application/json')throw Error("STATIC_INDEX");
 const p=await read(index.publication.path,index.publication.bytes,undefined,!archive&&index.publication.path===`data/${index.publication.sha256}.json`,archive);if(p.length!==index.publication.bytes||await hash(p)!==index.publication.sha256)throw Error("STATIC_PUBLICATION_HASH");
 const value=JSON.parse(new TextDecoder().decode(p)) as PublicPublication,draft=newDraft();draft.schemaVersion=value.exhibition.schemaVersion;draft.exhibitionId=value.exhibition.id;draft.candidate=value.exhibition;
 if(value.publication.status!=="published"||!validateDraft(draft).valid||!validateFurnishings(value.exhibition).valid||!validFootstepPublication(value)||await hash(new TextEncoder().encode(freezeCanonical(value.exhibition)))!==value.publication.revisionSha256)throw Error("STATIC_PUBLICATION");
 const workspace=value.exhibition.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;if(!validateWorkspaceFurnishings(value.exhibition).valid||!publicWorkspaceFurnishingRights(workspace))throw Error('STATIC_WORKSPACE_FURNISHING');
 const workspaceAssets=workspace?.furnishings??[];
 const material=value.exhibition.extensions?.['org.exhibitos.studio/workspace-materials'];if(!publicWorkspaceMaterialRights(material))throw Error('STATIC_WORKSPACE_MATERIAL');
 const materialAssets=[...new Map(workspaceFloorMaterials(value.exhibition).map(({material:item})=>[item.id,item])).values()];
 const ids=new Set<string>();for(const entry of index.assets){if(!entry.assetId||ids.has(entry.assetId)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>25*1024*1024||! /^[a-f0-9]{64}$/.test(entry.sha256))throw Error("STATIC_ASSET");ids.add(entry.assetId);}
 if(value.assets.length!==ids.size||new Set(value.assets.map(a=>a.assetId)).size!==ids.size||value.assets.some(a=>!index.assets.some(e=>e.assetId===a.assetId&&e.mime===a.mime)||a.url!==`/api/v1/publications/${value.publication.id}/assets/${a.assetId}`))throw Error("STATIC_ASSETS");
 if(workspaceAssets.some(item=>!index.assets.some(entry=>entry.assetId===item.id&&entry.path===`data/${item.model.sha256}.bin`&&entry.bytes===item.model.bytes&&entry.sha256===item.model.sha256&&entry.mime===item.model.mime)||!value.assets.some(asset=>asset.assetId===item.id&&asset.mime===item.model.mime)))throw Error('STATIC_WORKSPACE_FURNISHING');
 if(materialAssets.some(item=>!index.assets.some(entry=>entry.assetId===item.id&&entry.path===`data/${item.maps.color.sha256}.bin`&&entry.bytes===item.maps.color.bytes&&entry.sha256===item.maps.color.sha256&&entry.mime===item.maps.color.mime)||!value.assets.some(asset=>asset.assetId===item.id&&asset.mime===item.maps.color.mime)))throw Error('STATIC_WORKSPACE_MATERIAL');
 if(value.coverVariants&&!validateCoverVariantDescriptor(value))delete value.coverVariants;
 const resources=index.resources??[];if(resources.length!==(value.resources?.length??0)||new Set(resources.map(r=>r.sha256)).size!==resources.length||resources.some(r=>!r||Object.keys(r).sort().join(',')!=='bytes,mime,path,sha256'||r.path!==`data/${r.sha256}.bin`||!value.resources?.some(v=>v.sha256===r.sha256&&v.bytes===r.bytes&&v.mime===r.mime))||Boolean(resources.length)!==(index.version===2||index.version===3&&!!value.resources?.length))throw Error('STATIC_RESOURCES');
 const furniture=furnishingsFor(value.exhibition)?.assets??[],expectedNotices=packageFurnishingNoticeManifest(value.exhibition),notices=index.furnishingNotices??[];
 if((index.version===3)!==Boolean(expectedNotices.length)||notices.length!==expectedNotices.length||(value.furnishingNotices?.length??0)!==expectedNotices.length||new Set(notices.map(n=>n.assetId)).size!==notices.length||furniture.some(a=>!value.assets.some(e=>e.assetId===a.id&&e.mime===a.mime)||!index.assets.some(e=>e.assetId===a.id&&e.bytes===a.bytes&&e.sha256===a.sha256&&e.mime===a.mime))||notices.some(n=>{const expected=expectedNotices.find(e=>e.assetId===n.assetId),declared=value.furnishingNotices?.find(e=>e.assetId===n.assetId);return !expected||!declared||Object.keys(n).sort().join(',')!=='assetId,bytes,mime,path,sha256'||n.path!==`data/${n.sha256}.bin`||n.bytes!==expected.bytes||n.sha256!==expected.sha256||n.mime!==expected.mime||Object.keys(declared).sort().join(',')!=='assetId,bytes,mime,sha256,url'||declared.url!==`/api/v1/publications/${value.publication.id}/furnishing-notices/${expected.assetId}`||declared.bytes!==n.bytes||declared.sha256!==n.sha256||declared.mime!==n.mime;}))throw Error('STATIC_FURNISHING');
 const fetcher:typeof fetch=async(input,init)=>{const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
 const asset=value.assets.find(a=>a.url===url),resource=value.resources?.find(r=>r.url===url),notice=value.furnishingNotices?.find(r=>r.url===url),entry=asset?index.assets.find(e=>e.assetId===asset.assetId):resource?resources.find(e=>e.sha256===resource.sha256):notice?notices.find(e=>e.assetId===notice.assetId):undefined;if(!entry||init?.method&&init.method!=="GET")throw Error("STATIC_ASSET_URL");
 const workspaceAsset=!!asset&&(workspaceAssets.some(item=>item.id===asset.assetId)||materialAssets.some(item=>item.id===asset.assetId));
 if(resource||notice||workspaceAsset)await check();
 const data=await read(entry.path,entry.bytes,init?.signal??undefined,entry.path===`data/${entry.sha256}.bin`);if(data.length!==entry.bytes||await hash(data)!==entry.sha256)throw Error("STATIC_ASSET_HASH");
 if(resource||notice||workspaceAsset)await check();
 return new Response(new Uint8Array(data),{headers:{"content-type":entry.mime,"content-length":String(data.length),"x-exhibitos-publication-revision":value.publication.revisionSha256}});};
 const check=async()=>{if(!validateExhibition(value.exhibition,{publicationTime:new Date().toISOString()}).valid||!publicWorkspaceFurnishingRights(workspace)||!publicWorkspaceMaterialRights(material))throw Error("STATIC_DISPLAY_RIGHTS");};await check();
 return {...value,local:{kind:"static",fetcher,check}};
}
