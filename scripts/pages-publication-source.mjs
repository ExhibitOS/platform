// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {revisionHash,validateExhibition} from '@exhibitos/spec';
import {checkOexProfile} from '../apps/api/dist/oex.js';
import {spaceStillFor} from '@exhibitos/spec/space-still';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
const sha=b=>createHash('sha256').update(b).digest('hex'),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,hex=/^[a-f0-9]{64}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),keys=(v,list)=>object(v)&&Object.keys(v).sort().join(',')===[...list].sort().join(',');
const unavailable=()=>{throw Error('PAGES_PUBLICATION_UNAVAILABLE');};
/** Public Pages bytes only: no credentials, database writes, source imports, role grants or fallback revisions. */
export function createPagesPublicationSource({origin:clientOrigin,publicationId,revisionSha256,indexSha256,fetch:fetcher=globalThis.fetch,now=()=>new Date().toISOString()}){
 let origin;try{origin=new URL(clientOrigin);}catch{unavailable();}
 if(origin.origin!==clientOrigin||origin.protocol!=='https:'||origin.username||origin.password||!uuid.test(publicationId)||!hex.test(revisionSha256)||!hex.test(indexSha256))unavailable();
 const get=async(path,limit)=>{
  if(!/^\/(?:static-publication-index\.json|data\/[a-f0-9]{64}\.(?:json|bin))$/.test(path))unavailable();
  const response=await fetcher(new URL(path,origin),{credentials:'omit',redirect:'error',cache:'no-store',headers:{accept:path.endsWith('.json')?'application/json':'application/octet-stream'},signal:AbortSignal.timeout(15000)});
  if(!response.ok||response.redirected||response.url&&new URL(response.url).origin!==origin.origin||!response.body)unavailable();
  const reader=response.body.getReader(),chunks=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)unavailable();chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}return Buffer.concat(chunks);
 };
 const rights=value=>{if(!validateExhibition(value.exhibition,{publicationTime:now()}).valid)unavailable();};
 const snapshot=async()=>{
  const bytes=await get('/static-publication-index.json',1048576);if(sha(bytes)!==indexSha256)unavailable();const index=JSON.parse(bytes.toString('utf8'));
  if(!(index.version===1&&keys(index,['version','publication','assets'])||index.version===2&&keys(index,['version','publication','assets','resources'])&&Array.isArray(index.resources))||!Array.isArray(index.assets)||index.assets.length>20000||!keys(index.publication,['path','bytes','sha256','mime']))unavailable();
  const p=index.publication;if(!hex.test(p.sha256)||p.path!==`data/${p.sha256}.json`||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>1048576||p.mime!=='application/json')unavailable();
  const data=await get('/'+p.path,p.bytes);if(data.length!==p.bytes||sha(data)!==p.sha256)unavailable();const value=JSON.parse(data.toString('utf8'));
  if(!(index.version===1&&keys(value,['publication','exhibition','assets'])||index.version===2&&keys(value,['publication','exhibition','assets','resources'])&&Array.isArray(value.resources))||!keys(value.publication,['id','revisionSha256','publishedAt','status'])||value.publication.id!==publicationId||value.publication.revisionSha256!==revisionSha256||value.publication.status!=='published'||!Number.isFinite(Date.parse(value.publication.publishedAt))||revisionHash(value.exhibition)!==revisionSha256||!Array.isArray(value.assets))unavailable();
  checkOexProfile(value.exhibition);rights(value);
  const still=spaceStillFor(value.exhibition),inventory=new Map();for(const asset of [...value.exhibition.artworks.flatMap(a=>a.assets),...value.exhibition.mediaAssets,...(still?[still]:[])]){const previous=inventory.get(asset.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(asset))unavailable();inventory.set(asset.id,asset);}
  const entries=new Map();for(const e of index.assets){if(!keys(e,['assetId','path','bytes','sha256','mime'])||!uuid.test(e.assetId)||entries.has(e.assetId)||!hex.test(e.sha256)||e.path!==`data/${e.sha256}.bin`||!Number.isSafeInteger(e.bytes)||e.bytes<1||e.bytes>25*1024*1024||!['image/png','model/gltf-binary','audio/wav'].includes(e.mime))unavailable();const original=inventory.get(e.assetId);if(!original||original.bytes!==e.bytes||original.sha256!==e.sha256||original.mime!==e.mime)unavailable();entries.set(e.assetId,e);}
  if(entries.size!==inventory.size||value.assets.length!==entries.size||new Set(value.assets.map(a=>a.assetId)).size!==entries.size||value.assets.some(a=>!keys(a,['assetId','url','mime'])||a.url!==`/api/v1/publications/${publicationId}/assets/${a.assetId}`||entries.get(a.assetId)?.mime!==a.mime))unavailable();
  const expected=footstepResourcesFor(value.exhibition),resources=new Map();
  if(index.version===1&&expected.length||index.version===2&&(!expected.length||index.resources.length!==expected.length||value.resources.length!==expected.length))unavailable();
  for(const e of index.resources??[]){const known=expected.find(v=>v.sha256===e.sha256);if(!keys(e,['path','bytes','sha256','mime'])||!known||resources.has(e.sha256)||e.path!==`data/${e.sha256}.bin`||e.bytes!==known.bytes||e.mime!==known.mime)unavailable();resources.set(e.sha256,e);}
  if(index.version===2&&(new Set(value.resources.map(r=>r.sha256)).size!==expected.length||value.resources.some(r=>!keys(r,['sha256','bytes','mime','url'])||r.url!==`/api/v1/publications/${publicationId}/resources/${r.sha256}`||resources.get(r.sha256)?.bytes!==r.bytes||resources.get(r.sha256)?.mime!==r.mime)))unavailable();
  return {value,entries,resources};
 };
 const source={async anonymous(id,assetId){try{
  if(id!==publicationId||assetId!==undefined&&!uuid.test(assetId))unavailable();const {value,entries}=await snapshot();if(assetId===undefined)return value;
  const e=entries.get(assetId);if(!e)unavailable();const bytes=await get('/'+e.path,e.bytes);if(bytes.length!==e.bytes||sha(bytes)!==e.sha256)unavailable();rights(value);return {bytes,mime:e.mime,revisionSha256};
 }catch{unavailable();}}};
 return {...source,asset:(id,assetId)=>{if(typeof assetId!=="string")unavailable();return source.anonymous(id,assetId);},resource:async(id,hash)=>{try{if(id!==publicationId||!hex.test(hash))unavailable();const {value,resources}=await snapshot(),e=resources.get(hash);if(!e)unavailable();const bytes=await get('/'+e.path,e.bytes);if(bytes.length!==e.bytes||sha(bytes)!==e.sha256)unavailable();rights(value);return {bytes,mime:e.mime,revisionSha256};}catch{unavailable();}}};
}
