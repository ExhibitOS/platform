// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const requireValue=(v,code='AGENT_PROJECTION_CONTENT')=>{if(!v)throw Error(code);};
/** Exact current native copyForPublication delta, checked against the retained
 * source draft. Inputs requiring another installation rewrite are unsupported. */
export function checkedPrivateCopy(receipt){
 const source=receipt.sourceDraft,actual=receipt.publication?.intent?.snapshot;
 requireValue(source&&actual&&source.id===receipt.saved.draftId&&source.exhibitionId===receipt.saved.exhibitionId&&source.editVersion===receipt.binding.expectedEditVersion&&hash(canonical(source.candidate))===receipt.candidateSha256,'AGENT_SOURCE_BODY');
 requireValue(uuid.test(actual.id)&&uuid.test(actual.exhibitionId)&&uuid.test(actual.candidate?.revisionId)&&actual.candidate.id===actual.exhibitionId&&actual.id!==source.id&&actual.exhibitionId!==source.exhibitionId&&actual.createdAt===actual.updatedAt&&actual.createdAt===actual.candidate.createdAt&&Number.isFinite(Date.parse(actual.createdAt)),'AGENT_PRIVATE_COPY');
 const expected=structuredClone(source);Object.assign(expected,{id:actual.id,exhibitionId:actual.exhibitionId,editVersion:1,createdAt:actual.createdAt,updatedAt:actual.createdAt});Object.assign(expected.candidate,{id:actual.exhibitionId,revisionId:actual.candidate.revisionId,revision:1,createdAt:actual.createdAt});requireValue(canonical(expected)===canonical(actual),'AGENT_PRIVATE_COPY');return actual.candidate;
}
/** Narrow comparison of the EXISTING producer projection for this artwork
 * export. Only schema identity fields, typed identity-keyed maps and generated
 * asset path segments may differ. Prose/unknown string values remain exact. */
export function compareProjectedContent(expected,actual){
 const typedPaths=new Set(`id
revisionId
rooms/[]/id
surfaces/[]/id
surfaces/[]/roomId
openings/[]/id
openings/[]/surfaceId
openings/[]/connectsToOpeningId
artworks/[]/id
artworks/[]/revisionId
artworks/[]/primaryAssetId
artworks/[]/assets/[]/id
artworks/[]/provenance/events/[]/id
artworks/[]/extensions/org.exhibitos.viewer/lod/variants/[]/assetId
artworks/[]/extensions/org.exhibitos.viewer/thumbnail/assetId
placements/[]/id
placements/[]/roomId
placements/[]/artworkRevisionId
placements/[]/assetId
lights/[]/id
lights/[]/roomId
lights/[]/targetPlacementId
accessibility/artworkDescriptions/[]/placementId
accessibility/routeIds/[]
extensions/org.exhibitos.studio/architectural-finishes/walls/[]/surfaceId
extensions/org.exhibitos.studio/benches/benches/[]/id
extensions/org.exhibitos.studio/benches/benches/[]/roomId
extensions/org.exhibitos.studio/benches/benches/[]/viewpointId
extensions/org.exhibitos.studio/installation/placements/[]/placementId
extensions/org.exhibitos.studio/light-details/lights/[]/lightId
extensions/org.exhibitos.studio/plaques/plaques/[]/id
extensions/org.exhibitos.studio/plaques/plaques/[]/roomId
extensions/org.exhibitos.studio/presentation/startCamera/roomId
extensions/org.exhibitos.studio/presentation/viewpoints/[]/id
extensions/org.exhibitos.studio/presentation/viewpoints/[]/roomId
extensions/org.exhibitos.viewer/entrance/imageAssetId
extensions/org.exhibitos.viewer/experience/footsteps/[]/surfaceId`.split('\n'));
 const ids=new Map(),inverse=new Map();const bind=(a,b)=>{requireValue(uuid.test(a)&&uuid.test(b),'AGENT_PROJECTION_ID');requireValue(!ids.has(a)||ids.get(a)===b,'AGENT_PROJECTION_ID');requireValue(!inverse.has(b)||inverse.get(b)===a,'AGENT_PROJECTION_ID');ids.set(a,b);inverse.set(b,a);};
 const collect=(a,b,path=[])=>{if(Array.isArray(a)){requireValue(Array.isArray(b)&&a.length===b.length);a.forEach((v,i)=>collect(v,b[i],[...path,'[]']));}else if(a&&typeof a==='object'){requireValue(b&&typeof b==='object'&&!Array.isArray(b));for(const [k,v] of Object.entries(a)){const next=[...path,k];if((k==='id'||k==='revisionId')&&typedPaths.has(next.join('/'))&&typeof v==='string'&&uuid.test(v))bind(v,b[k]);else if(Object.hasOwn(b,k))collect(v,b[k],next);}}};collect(expected,actual);
 const mapped=(v,path=[])=>{
  if(typeof v==='string'){
   const key=path.join('/');if(typedPaths.has(key)&&uuid.test(v)){requireValue(ids.has(v),'AGENT_PROJECTION_ID');return ids.get(v);}
   if(key==='artworks/[]/assets/[]/path'&&/^assets\/[a-f0-9-]{36}\/(image\.png|model\.glb|thumbnail\.png)$/.test(v)){const parts=v.split('/');requireValue(ids.has(parts[1]),'AGENT_PROJECTION_ID');parts[1]=ids.get(parts[1]);return parts.join('/');}return v;
  }
  if(Array.isArray(v))return v.map(x=>mapped(x,[...path,'[]']));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,mapped(x,[...path,k])]));return v;
 };
 requireValue(canonical(mapped(expected))===canonical(actual));return ids;
}
/** Runtime root/digest are owner config, never fields in the agent JSON. The
 * module suffix is fixed; reuse exact admitted producer rather than current API. */
export async function checkedPublicProjection({receipt,publication,files,runtimeRoot,runtimeSha256,signal}){
 const candidate=checkedPrivateCopy(receipt);requireValue(isAbsolute(runtimeRoot??'')&&await realpath(runtimeRoot)===runtimeRoot,'AGENT_PRODUCER');const manifestPath=join(runtimeRoot,'manifest.json'),bytes=await readFile(manifestPath);requireValue(hash(bytes)===runtimeSha256,'AGENT_PRODUCER');const manifest=JSON.parse(bytes);
 const pinned=async name=>{const path='platform/apps/api/dist/'+name;const entry=manifest.files.find(f=>f.path===path);requireValue(entry&&await realpath(join(runtimeRoot,path))===join(runtimeRoot,path),'AGENT_PRODUCER');const content=await readFile(join(runtimeRoot,path));requireValue(content.length===entry.bytes&&hash(content)===entry.sha256,'AGENT_PRODUCER');return {url:pathToFileURL(join(runtimeRoot,path)),sha256:entry.sha256};};
 const producer=await pinned('publication.js'),variant=await pinned('viewer-variants.js');signal.throwIfAborted();const {projectPublication}=await import(producer.url),{measureFullVariant}=await import(variant.url);
 requireValue([13,15].includes(candidate.artworks.length)&&publication.exhibition.artworks.length===candidate.artworks.length&&candidate.mediaAssets.length===0&&!candidate.extensions?.['org.exhibitos.studio/furnishings'],'AGENT_PROJECTION_UNSUPPORTED');
 const blob=async asset=>{const matches=[...files.values()].filter(f=>f.entry.assetId===asset.id&&f.entry.sha256===asset.sha256&&f.entry.bytes===asset.bytes&&f.entry.mime===asset.mime);requireValue(matches.length===1,'AGENT_PROJECTION_ASSET');const {path}=matches[0];requireValue((await lstat(path)).isFile(),'AGENT_PROJECTION_ASSET');const value=await readFile(path);signal.throwIfAborted();requireValue(value.length===asset.bytes&&hash(value)===asset.sha256,'AGENT_PROJECTION_ASSET');return value;};
 const prepared=[];const used=new Set();for(const artwork of candidate.artworks){
  const primary=artwork.assets.find(a=>a.id===artwork.primaryAssetId);const matches=publication.exhibition.artworks.filter(a=>a.assets.find(x=>x.id===a.primaryAssetId)?.sha256===primary.sha256);requireValue(matches.length===1&&!used.has(matches[0].id),'AGENT_PROJECTION_ASSET');const publicArt=matches[0];used.add(publicArt.id);
  const assetFor=source=>{const found=publicArt.assets.filter(a=>a.sha256===source.sha256&&a.bytes===source.bytes&&a.mime===source.mime&&a.role===source.role);requireValue(found.length===1,'AGENT_PROJECTION_ASSET');return found[0];};
  const full=await blob(assetFor(primary)),sourceLod=artwork.extensions?.['org.exhibitos.viewer/lod'],low=sourceLod?.variants.find(v=>v.detail==='coarse'),preview=artwork.assets.find(a=>a.role==='preview');let variants={full:measureFullVariant(full,primary.mime)},coarseSource,thumbnail;
  if(low){const source=artwork.assets.find(a=>a.id===low.assetId);requireValue(source,'AGENT_PROJECTION_ASSET');const bytes=await blob(assetFor(source));variants={...variants,...(sourceLod.profile?{profile:sourceLod.profile}:{}),coarse:measureFullVariant(bytes,source.mime),bytes};coarseSource={id:source.id,sha256:source.sha256};}
  if(preview)thumbnail={sourceAssetId:preview.id,sourceSha256:preview.sha256,bytes:await blob(assetFor(preview))};
  prepared.push({artwork,sourceAssetId:primary.id,sourceSha256:primary.sha256,bytes:full,mime:primary.mime,variants,...(coarseSource?{coarseSource}:{}),...(thumbnail?{thumbnail}:{})});
 }
 const expected=projectPublication(candidate,prepared,publication.publication.publishedAt).snapshot,ids=compareProjectedContent(expected,publication.exhibition);
 const mapRows=field=>candidate[field].map((v,i)=>({source:v.id,exported:ids.get(expected[field][i].id)}));
 const sourceViews=candidate.extensions?.['org.exhibitos.studio/presentation']?.viewpoints??[],expectedViews=expected.extensions?.['org.exhibitos.studio/presentation']?.viewpoints??[];
 return {producer:{manifestSha256:runtimeSha256,sourceCommit:manifest.sourceCommit,publicationModuleSha256:producer.sha256,measureModuleSha256:variant.sha256},privateCandidateSha256:hash(canonical(candidate)),checkedArtworkBytes:prepared.length,placements:mapRows('placements'),viewpoints:sourceViews.map((v,i)=>({source:v.id,exported:ids.get(expectedViews[i].id)}))};
}
