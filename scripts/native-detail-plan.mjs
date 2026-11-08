// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {ARTWORK_DETAIL_QUALITY_NAMESPACE,freezeCanonical,verifiedParsedDetailQuality} from '@exhibitos/studio-contract';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=()=>{throw Error('NATIVE_DETAIL_PLAN');};

/** Structural export plan only. No rights, source, decoder, or owner authority
 * comes from the caller's projection; the server must independently recheck. */
export async function buildNativeDetailPlan(publicationId,exhibition,ordinaryAssets,descriptors){
 if(typeof publicationId!=='string'||!uuid.test(publicationId)||!Array.isArray(exhibition?.artworks)||!Array.isArray(ordinaryAssets)||!Array.isArray(descriptors)||descriptors.length>16)fail();
 let snapshot;try{snapshot=structuredClone({exhibition,ordinaryAssets,descriptors});}catch{fail();}
 const ordinary=new Set();for(const asset of snapshot.ordinaryAssets){if(!asset||typeof asset.assetId!=='string')fail();ordinary.add(asset.assetId.toLowerCase());}
 const ids=new Set(),candidates=new Set(),hashes=new Map(),plan=[];let total=0;
 for(const artwork of snapshot.exhibition.artworks){
  const relation=artwork?.extensions?.[ARTWORK_DETAIL_QUALITY_NAMESPACE];if(relation===undefined)continue;
  if(artwork.artworkType!=='image'&&artwork.artworkType!=='sculpture')fail();const verified=await verifiedParsedDetailQuality(relation,artwork.artworkType);if(!verified)fail();
  for(const candidate of verified.candidates){
   const {assetId,candidateId,sha256,bytes,mime,sourceBindingSha256,featureReportSha256}=candidate,previous=hashes.get(sha256);if(ids.has(assetId)||candidates.has(candidateId)||ordinary.has(assetId)||bytes>25*1024*1024||previous&&(previous.bytes!==bytes||previous.mime!==mime))fail();ids.add(assetId);candidates.add(candidateId);hashes.set(sha256,{bytes,mime});total+=bytes;if(ids.size>16||total>100*1024*1024)fail();
   const matches=snapshot.descriptors.filter(item=>item?.assetId===assetId);if(matches.length!==1||!exact(matches[0],['assetId','url','mime'])||matches[0].url!==`/api/v1/publications/${publicationId}/detail-assets/${assetId}`||matches[0].mime!==mime)fail();
   plan.push({assetId,sourceBindingSha256,sha256,bytes,mime,featureReportSha256});
  }
 }
 if(ids.size!==snapshot.descriptors.length)fail();plan.sort((a,b)=>a.assetId<b.assetId?-1:a.assetId>b.assetId?1:0);
 const detailSetSha256=createHash('sha256').update(freezeCanonical(plan),'utf8').digest('hex');for(const item of plan)Object.freeze(item);return Object.freeze({entries:Object.freeze(plan),detailSetSha256,totalBytes:total});
}
