// SPDX-License-Identifier: AGPL-3.0-or-later
// Constants exist only in the static build. Other Viewer entry points report unknown.
declare const __EXHIBITOS_VIEWER_BUILD_ID__: string | undefined;
declare const __EXHIBITOS_VIEWER_PACKAGE_VERSION__: string | undefined;
declare const __EXHIBITOS_VIEWER_SOURCE_COMMIT__: string | null | undefined;
export type RuntimeHistory = {runtimeVersion:string|null;sourceCommit:string|null;buildId:string|null;outputGeneratedAt:string|null;deployedAt:string|null};
export function readRuntimeHistory(doc:Document):RuntimeHistory {
 const version=typeof __EXHIBITOS_VIEWER_PACKAGE_VERSION__==='string'?__EXHIBITOS_VIEWER_PACKAGE_VERSION__:null;
 const commit=typeof __EXHIBITOS_VIEWER_SOURCE_COMMIT__==='string'?__EXHIBITOS_VIEWER_SOURCE_COMMIT__:null;
 const built=typeof __EXHIBITOS_VIEWER_BUILD_ID__==='string'?__EXHIBITOS_VIEWER_BUILD_ID__:null;
 const buildTags=doc.querySelectorAll('meta[name="exhibitos-viewer-build-id"]');
 const buildId=built&&/^[a-f0-9]{64}$/.test(built)&&buildTags.length===1&&buildTags[0]?.getAttribute('content')===built?built:null;
 return {runtimeVersion:buildId&&version&&/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version)?version:null,
  sourceCommit:buildId&&commit&&/^[a-f0-9]{40}$/.test(commit)?commit:null,buildId,
  outputGeneratedAt:null,
  deployedAt:null};
}

const digestHex=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
const exactKeys=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const utc=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
async function bounded(response:Response,limit:number){
 if(!response.ok||!response.body)throw Error('metadata unavailable');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('metadata too large');chunks.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
/** Optional lookup for the displayed build. Any stale, missing, offline or unverified evidence is unknown. */
export type ActivePublicationIdentity={indexSha256:string;publicationId:string;revisionSha256:string};
export async function resolveConfirmedDeployment(doc:Document,active:ActivePublicationIdentity,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<string|null>{
 try{
  const history=readRuntimeHistory(doc);if(!history.buildId||!history.sourceCommit)return null;
  const current=doc.querySelectorAll('meta[name="exhibitos-static-index"]');if(current.length!==1)return null;
  const currentIndex=current[0]?.getAttribute('content');if(!currentIndex||currentIndex!==active.indexSha256||!/^[a-f0-9]{64}$/.test(currentIndex)||!/^[a-f0-9]{64}$/.test(active.revisionSha256)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(active.publicationId))return null;
  const location=doc.location,base=new URL(doc.baseURI);if(!location||base.origin!==location.origin||base.origin!=='https://demo.exhibitos.org'||base.username||base.password)return null;
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);
  const options:RequestInit={credentials:'omit',redirect:'error',cache:'no-store',signal:requestSignal};
  const manifestBytes=await bounded(await fetcher(new URL('/static-export-manifest.json',base),options),4*1024*1024);
  const manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
  if(manifest.format!=='exhibitos-static-publication-v1'||manifest.indexSha256!==currentIndex||manifest.publicationId!==active.publicationId||manifest.revisionSha256!==active.revisionSha256||!Array.isArray(manifest.files))return null;
  const entries=manifest.files.filter((entry:{path?:unknown})=>entry.path==='index.html');if(entries.length!==1)return null;
  const entry=entries[0];if(!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>2*1024*1024||!/^[a-f0-9]{64}$/.test(entry.sha256))return null;
  const htmlBytes=await bounded(await fetcher(new URL('/',base),options),entry.bytes);if(htmlBytes.length!==entry.bytes||await digestHex(htmlBytes)!==entry.sha256)return null;
  const parsed=new DOMParser().parseFromString(new TextDecoder().decode(htmlBytes),'text/html');
  const builds=parsed.querySelectorAll('meta[name="exhibitos-viewer-build-id"]'),indexes=parsed.querySelectorAll('meta[name="exhibitos-static-index"]');
  if(builds.length!==1||builds[0]?.getAttribute('content')!==history.buildId||indexes.length!==1||indexes[0]?.getAttribute('content')!==currentIndex)return null;
  const liveScripts=doc.querySelectorAll('script[type="module"][src]'),verifiedScripts=parsed.querySelectorAll('script[type="module"][src]');
  if(liveScripts.length!==1||verifiedScripts.length!==1)return null;
  const src=liveScripts[0]?.getAttribute('src');if(!src||src!==verifiedScripts[0]?.getAttribute('src')||!/^\/?assets\/[A-Za-z0-9_.-]+\.js$/.test(src))return null;
  const entryPath=src.replace(/^\//,''),modules=manifest.files.filter((item:{path?:unknown})=>item.path===entryPath);if(modules.length!==1)return null;
  const module=modules[0];if(!Number.isSafeInteger(module.bytes)||module.bytes<1||module.bytes>4*1024*1024||!/^[a-f0-9]{64}$/.test(module.sha256))return null;
  const moduleBytes=await bounded(await fetcher(new URL(src,base),options),module.bytes);if(moduleBytes.length!==module.bytes||await digestHex(moduleBytes)!==module.sha256)return null;
  const manifestSha=await digestHex(manifestBytes),url=`https://raw.githubusercontent.com/ExhibitOS/demo/deployment-receipts/deployment-receipts/${manifestSha}.json`;
  const receipt=JSON.parse(new TextDecoder().decode(await bounded(await fetcher(url,options),16384)));
  const fields=['schema','artifactManifestSha256','runtimeSourceCommit','buildId','confirmedDeploymentAt','verifiedAt','deploymentId','workerVersionId','trafficPercent'];
  if(!exactKeys(receipt,fields)||receipt.schema!=='exhibitos-deployment-receipt-v1'||receipt.artifactManifestSha256!==manifestSha||receipt.runtimeSourceCommit!==history.sourceCommit||receipt.buildId!==history.buildId||receipt.trafficPercent!==100||!utc(receipt.confirmedDeploymentAt)||!utc(receipt.verifiedAt)||Date.parse(receipt.verifiedAt)<Date.parse(receipt.confirmedDeploymentAt)||typeof receipt.deploymentId!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(receipt.deploymentId)||typeof receipt.workerVersionId!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(receipt.workerVersionId))return null;
  if(requestSignal.aborted)return null;
  return receipt.confirmedDeploymentAt;
 }catch{return null;}
}
