import type { PublicPublication } from "./publication-client";
import { freezeCanonical } from "@exhibitos/studio-contract";
import { newDraft } from "./drafts/example";
import { validateExhibition } from "./drafts/exhibition-validation.mjs";
import { validateDraft } from "./drafts/validator";
interface FileEntry {path:string;bytes:number;sha256:string;mime:string;assetId?:string}
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)))].map(x=>x.toString(16).padStart(2,"0")).join("");
async function read(path:string,limit:number,signal?:AbortSignal){
 if(!/^data\/[a-f0-9]{64}\.(json|bin)$/.test(path)&&path!=="static-publication-index.json")throw Error("STATIC_PATH");
 const response=await fetch("/"+path,{credentials:"omit",cache:"no-store",signal:signal??AbortSignal.timeout(30000),redirect:"error"});
 if(!response.ok||!response.body)throw Error("STATIC_RESPONSE");const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error("STATIC_SIZE");chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const result=new Uint8Array(length);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}
export async function loadStaticPublication():Promise<PublicPublication>{
 const expected=document.querySelector<HTMLMetaElement>('meta[name="exhibitos-static-index"]')?.content;
 if(!expected||! /^[a-f0-9]{64}$/.test(expected))throw Error("STATIC_INDEX");
 const bytes=await read("static-publication-index.json",1048576);if(await hash(bytes)!==expected)throw Error("STATIC_INDEX_HASH");
 const index=JSON.parse(new TextDecoder().decode(bytes)) as {version:number;publication:FileEntry;assets:FileEntry[]};
 if(index.version!==1||!Array.isArray(index.assets)||index.assets.length>20000)throw Error("STATIC_INDEX");
 const p=await read(index.publication.path,1048576);if(p.length!==index.publication.bytes||await hash(p)!==index.publication.sha256)throw Error("STATIC_PUBLICATION_HASH");
 const value=JSON.parse(new TextDecoder().decode(p)) as PublicPublication,draft=newDraft();draft.exhibitionId=value.exhibition.id;draft.candidate=value.exhibition;
 if(value.publication.status!=="published"||!validateDraft(draft).valid||await hash(new TextEncoder().encode(freezeCanonical(value.exhibition)))!==value.publication.revisionSha256)throw Error("STATIC_PUBLICATION");
 const ids=new Set<string>();for(const entry of index.assets){if(!entry.assetId||ids.has(entry.assetId)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>25*1024*1024||! /^[a-f0-9]{64}$/.test(entry.sha256))throw Error("STATIC_ASSET");ids.add(entry.assetId);}
 if(value.assets.length!==ids.size||value.assets.some(a=>!index.assets.some(e=>e.assetId===a.assetId&&e.mime===a.mime)||a.url!==`/api/v1/publications/${value.publication.id}/assets/${a.assetId}`))throw Error("STATIC_ASSETS");
 const fetcher:typeof fetch=async(input,init)=>{const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
 const asset=value.assets.find(a=>a.url===url),entry=asset&&index.assets.find(e=>e.assetId===asset.assetId);if(!entry||init?.method&&init.method!=="GET")throw Error("STATIC_ASSET_URL");
 const data=await read(entry.path,entry.bytes,init?.signal??undefined);if(data.length!==entry.bytes||await hash(data)!==entry.sha256)throw Error("STATIC_ASSET_HASH");
 return new Response(new Uint8Array(data),{headers:{"content-type":entry.mime,"content-length":String(data.length),"x-exhibitos-publication-revision":value.publication.revisionSha256}});};
 const check=async()=>{if(!validateExhibition(value.exhibition,{publicationTime:new Date().toISOString()}).valid)throw Error("STATIC_DISPLAY_RIGHTS");};await check();
 return {...value,local:{kind:"static",fetcher,check}};
}
