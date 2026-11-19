// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,realpath,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {checkedPrivateCopy,compareProjectedContent,checkedGeneratedPngCoarse,checkedPublicProjection} from './private-agent-publication.mjs';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function receipt(){const sourceDraft={id:randomUUID(),exhibitionId:randomUUID(),editVersion:2,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z',candidate:{id:'',revisionId:randomUUID(),revision:1,createdAt:'2026-11-01T00:00:00Z',title:'Keep geometry',rooms:[{id:randomUUID(),dimensions:{width:10,height:4,depth:8}}]}};sourceDraft.candidate.id=sourceDraft.exhibitionId;const snapshot=structuredClone(sourceDraft),time='2026-11-05T00:00:00Z';Object.assign(snapshot,{id:randomUUID(),exhibitionId:randomUUID(),editVersion:1,createdAt:time,updatedAt:time});Object.assign(snapshot.candidate,{id:snapshot.exhibitionId,revisionId:randomUUID(),createdAt:time,revision:1});return {sourceDraft,saved:{draftId:sourceDraft.id,exhibitionId:sourceDraft.exhibitionId,revision:3},binding:{expectedRevision:5,expectedEditVersion:2},candidateSha256:createHash('sha256').update(canonical(sourceDraft.candidate)).digest('hex'),publication:{intent:{snapshot}}};}
test('source native5/studio3 and private snapshot retain exact nonidentity body',()=>{const r=receipt();assert.deepEqual(checkedPrivateCopy(r),r.publication.intent.snapshot.candidate);assert.equal(r.sourceDraft.editVersion,2);});
test('same private identity with different body is rejected',()=>{const r=receipt();r.publication.intent.snapshot.candidate.rooms[0].dimensions.width=11;assert.throws(()=>checkedPrivateCopy(r),/AGENT_PRIVATE_COPY/);});
function pair(){const a=randomUUID(),b=randomUUID(),x=randomUUID(),y=randomUUID();return {expected:{id:a,rooms:[{id:b,title:'Literal '+a}],placements:[{id:randomUUID(),roomId:b,transform:{position:[1,2,3]}}],artworks:[{id:randomUUID(),assets:[{id:randomUUID(),sha256:'a'.repeat(64)}]}]},x,y};}
function copyIds(expected){const out=structuredClone(expected),ids=new Map();const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))if(k==='id'){if(!ids.has(x))ids.set(x,randomUUID());v[k]=ids.get(x);}else walk(x);};walk(out);out.placements[0].roomId=out.rooms[0].id;return out;}
test('consistent typed identities preserve prose and exact numeric content',()=>{const {expected}=pair(),actual=copyIds(expected);assert(compareProjectedContent(expected,actual).size>2);});
test('same IDs with altered geometry are rejected',()=>{const {expected}=pair(),actual=copyIds(expected);actual.placements[0].transform.position[0]=7;assert.throws(()=>compareProjectedContent(expected,actual),/AGENT_PROJECTION_CONTENT/);});
test('swapped or changed artwork bytes are rejected',()=>{const {expected}=pair(),actual=copyIds(expected);actual.artworks[0].assets[0].sha256='b'.repeat(64);assert.throws(()=>compareProjectedContent(expected,actual),/AGENT_PROJECTION_CONTENT/);});
test('UUID text in prose is never remapped',()=>{const {expected}=pair(),actual=copyIds(expected);actual.rooms[0].title='Literal '+actual.id;assert.throws(()=>compareProjectedContent(expected,actual),/AGENT_PROJECTION_CONTENT/);});
test('reused target IDs and noninjective mappings are rejected',()=>{const {expected}=pair(),actual=copyIds(expected);actual.placements[0].id=actual.rooms[0].id;assert.throws(()=>compareProjectedContent(expected,actual),/AGENT_PROJECTION_ID/);});
test('changed typed room reference is rejected',()=>{const {expected}=pair(),actual=copyIds(expected);actual.placements[0].roomId=actual.artworks[0].id;assert.throws(()=>compareProjectedContent(expected,actual),/AGENT_PROJECTION_CONTENT/);});

test('unknown metadata and extension identity-looking fields remain exact',()=>{for(const key of ['id','revisionId','roomId','path']){const {expected}=pair();const value=key==='path'?'assets/'+expected.id+'/image.png':expected.id;expected.metadata={opaque:{[key]:value}};expected.extensions={'org.example/opaque':{[key]:value}};const actual=copyIds(expected);actual.metadata.opaque[key]=key==='path'?'assets/'+actual.id+'/image.png':actual.id;actual.extensions['org.example/opaque'][key]=actual.metadata.opaque[key];assert.throws(()=>compareProjectedContent(expected,actual),/AGENT_PROJECTION_CONTENT/);}});

test('generated PNG coarse requires exact bytes and independent texture metric',()=>{
 const generated={bytes:Buffer.from('exact'),coarse:{textureSize:512}};assert.equal(checkedGeneratedPngCoarse(generated,Buffer.from('exact'),512),generated);
 for(const [value,bytes,metric] of [[generated,Buffer.from('altered'),512],[generated,Buffer.from('exact'),256],[{bytes:Buffer.from('exact')},Buffer.from('exact'),512],[{bytes:Buffer.from('exact'),coarse:{textureSize:512,extra:1}},Buffer.from('exact'),512]])assert.throws(()=>checkedGeneratedPngCoarse(value,bytes,metric),/AGENT_PROJECTION_ASSET/);
});

test('only observed typed floor, surface-material and plaque identities are remapped',()=>{
 const {expected}=pair();expected.surfaces=[{id:randomUUID(),roomId:expected.rooms[0].id}];expected.extensions={'org.exhibitos.studio/floors':{bindings:[{target:{surfaceId:expected.surfaces[0].id}}]},'org.exhibitos.studio/materials':{surfaceTextures:{[expected.surfaces[0].id]:{pack:'exact'}}},'org.exhibitos.studio/plaques':{plaques:[{id:randomUUID(),roomId:expected.rooms[0].id,source:{placementId:expected.placements[0].id}}],roomIntroductions:{[expected.rooms[0].id]:{text:'unchanged'}}}};
 const actual=copyIds(expected),surface=actual.surfaces[0].id,room=actual.rooms[0].id,placement=actual.placements[0].id;
 actual.surfaces[0].roomId=room;actual.extensions['org.exhibitos.studio/floors'].bindings[0].target.surfaceId=surface;actual.extensions['org.exhibitos.studio/materials'].surfaceTextures={[surface]:{pack:'exact'}};actual.extensions['org.exhibitos.studio/plaques'].plaques[0].roomId=room;actual.extensions['org.exhibitos.studio/plaques'].plaques[0].source.placementId=placement;actual.extensions['org.exhibitos.studio/plaques'].roomIntroductions={[room]:{text:'unchanged'}};
 assert(compareProjectedContent(expected,actual).size>0);actual.extensions['org.exhibitos.studio/materials'].surfaceTextures[surface].pack='changed';assert.throws(()=>compareProjectedContent(expected,actual),/AGENT_PROJECTION_CONTENT/);
});


test('projection requires a complete per-item match independent of artwork count',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'projection-cardinality-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const modules=[];
 async function module(path,bytes){
  const full=join(root,path);
  await mkdir(dirname(full),{recursive:true});
  await writeFile(full,bytes);
  modules.push({path,bytes:Buffer.byteLength(bytes),sha256:digest(bytes)});
 }
 // This pinned synthetic runtime gives the real admission path deterministic
 // projection/variant output without requiring a live server or render.
 await module('platform/apps/api/dist/publication.js',`
  export function projectPublication(candidate,prepared){
   const artworks=prepared.map(({artwork,variants})=>{
    if(!variants.coarse)return artwork;
    const bytes=variants.bytes;
    return {...artwork,assets:[...artwork.assets,{
     id:'11111111-1111-4111-8111-111111111111',role:'image',mime:'image/png',
     bytes:bytes.length,sha256:'${digest('coarse')}',
    }],extensions:{'org.exhibitos.viewer/lod':{variants:[{
     assetId:'11111111-1111-4111-8111-111111111111',detail:'coarse',textureSize:512,
    }]}}};
   });
   return {snapshot:{...candidate,artworks}};
  }
 `);
 await module('platform/apps/api/dist/viewer-variants.js',`
  export const measureFullVariant=()=>({textureSize:1024});
  export const viewerVariants=async()=>({coarse:{textureSize:512},bytes:Buffer.from('coarse')});
 `);
 for(const name of ['platform/apps/api/dist/viewer-variant-worker.js','platform/apps/api/dist/png-pixels.js','platform/node_modules/gltf-validator/fixture.js'])await module(name,'// pinned synthetic dependency');
 const manifest=JSON.stringify({nodeVersion:process.versions.node,files:modules});
 await writeFile(join(root,'manifest.json'),manifest);
 for(const count of [2,13,15]){
  const input=receipt(),source=input.sourceDraft.candidate,files=new Map();
  async function item(bytes,id=randomUUID()){
   const entry={id,role:'image',mime:'image/png',bytes:Buffer.byteLength(bytes),sha256:digest(bytes)};
   const path=join(root,id);
   await writeFile(path,bytes);
   files.set(id,{path,entry:{...entry,assetId:id}});
   return entry;
  }
  source.artworks=[];
  source.mediaAssets=[];
  for(let n=0;n<count;n++){
   const asset=await item(`artwork-${count}-${n}`);
   source.artworks.push({id:randomUUID(),primaryAssetId:asset.id,assets:[asset]});
  }
  source.placements=[];
  input.candidateSha256=digest(canonical(source));
  Object.assign(input.publication.intent.snapshot.candidate,{artworks:source.artworks,mediaAssets:[],placements:[]});
  const exhibition=structuredClone(input.publication.intent.snapshot.candidate);
  const coarse=await item('coarse');
  const artwork=exhibition.artworks[0];
  artwork.assets.push(coarse);
  artwork.extensions={'org.exhibitos.viewer/lod':{variants:[{assetId:coarse.id,detail:'coarse',textureSize:512}]}};
  const run=(candidate=input,body=exhibition)=>checkedPublicProjection({
   receipt:candidate,publication:{exhibition:body,publication:{publishedAt:'2026-11-05T00:00:00Z'}},
   files,runtimeRoot:root,runtimeSha256:digest(manifest),signal:new AbortController().signal,
  });
  assert.equal((await run()).checkedArtworkBytes,count);
  if(count!==2)continue;
  const missing=structuredClone(exhibition);
  missing.artworks.pop();
  await assert.rejects(run(input,missing),/AGENT_PROJECTION_UNSUPPORTED/);
  const duplicate=structuredClone(exhibition);
  duplicate.artworks[1].id=duplicate.artworks[0].id;
  await assert.rejects(run(input,duplicate),/AGENT_PROJECTION_ASSET/);
  const changed=structuredClone(exhibition);
  changed.artworks[0].extensions['org.exhibitos.viewer/lod'].variants[0].textureSize=1024;
  await assert.rejects(run(input,changed),/AGENT_PROJECTION_ASSET/);
  const media=structuredClone(input);
  media.sourceDraft.candidate.mediaAssets=[{id:randomUUID()}];
  media.publication.intent.snapshot.candidate.mediaAssets=media.sourceDraft.candidate.mediaAssets;
  media.candidateSha256=digest(canonical(media.sourceDraft.candidate));
  await assert.rejects(run(media),/AGENT_PROJECTION_UNSUPPORTED/);
 }
});
