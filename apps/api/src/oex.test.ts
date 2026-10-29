import {SPATIAL_NAMESPACE,spatialProgramFor,validateSpatialProfile} from '@exhibitos/studio-contract';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {fixtureURL,validateExhibition,type Exhibition} from '@exhibitos/spec';
import {CURATION_NAMESPACE,curationFor,validateViewerCuration,MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE,EXPERIENCE_NAMESPACE} from '@exhibitos/studio-contract';
import {checkOexProfile,remapOex,decodeOex,approvedImportedThumbnail,pinnedAuthoritySnapshot,portableOexSnapshot,withoutImportedPreviews,writeOexWithinBudget} from './oex.ts';
import {validMetadata} from './cms.ts';
import { ENTRANCE_NAMESPACE, entranceFor, validateViewerEntrance } from '@exhibitos/studio-contract';
async function fixture(){return JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8'))as Exhibition;}
describe('OEX service boundaries',()=>{
 it('preserves bounded poster settings and remaps the cover with its approved PNG inventory', async () => {
  const e = await fixture(), image = e.artworks.find(a => a.artworkType === 'image')!;
  const presentation={ticketTitle:image.primaryAssetId,ticketDetail:'Public ticket detail',ticketAnimation:true,coverUnfold:false,doorEffect:true};
  e.extensions = { [ENTRANCE_NAMESPACE]: { version: 1, artist: image.primaryAssetId, introduction: 'Public introduction', imageAssetId: image.primaryAssetId.toUpperCase(), imageAlt: 'Synthetic painting', mobilePosition: 'bottom',presentation } };
  expect(() => checkOexProfile(e)).not.toThrow();
  const mapped = remapOex(e).exhibition;
  expect(validateViewerEntrance(mapped).valid).toBe(true);
  expect(entranceFor(mapped).imageAssetId).toBe(mapped.artworks.find(a => a.artworkType === 'image')!.primaryAssetId);
  expect(entranceFor(mapped).artist).toBe(image.primaryAssetId);
  expect(entranceFor(mapped).presentation).toEqual(presentation);
  (e.extensions[ENTRANCE_NAMESPACE] as { imageAssetId: string }).imageAssetId = e.artworks.find(a => a.artworkType !== 'image')!.primaryAssetId;
  expect(() => checkOexProfile(e)).toThrow('OEX_PROFILE_INVALID');
 });
 it('accepts bounded spatial programs and remaps exact IDs without changing author rules or text',async()=>{
  const e=await fixture();e.extensions={[SPATIAL_NAMESPACE]:{version:1,rules:[{id:'author-rule',once:true,trigger:{type:'room_enter',roomId:e.rooms[0]!.id},actions:[{type:'set_light',lightId:e.lights[0]!.id,multiplier:.4,delayMs:0},{type:'show_text',text:e.lights[0]!.id,locale:'en',delayMs:0}]}]}};
  expect(()=>checkOexProfile(e)).not.toThrow();const mapped=remapOex(e).exhibition,p=spatialProgramFor(mapped);expect(validateSpatialProfile(mapped).valid).toBe(true);expect(p.rules[0]!.id).toBe('author-rule');expect(p.rules[0]!.trigger).toEqual({type:'room_enter',roomId:mapped.rooms[0]!.id});expect(p.rules[0]!.actions[0]).toMatchObject({lightId:mapped.lights[0]!.id});expect(p.rules[0]!.actions[1]).toMatchObject({text:e.lights[0]!.id});
  (e.extensions[SPATIAL_NAMESPACE] as {version:number}).version=2;expect(()=>checkOexProfile(e)).toThrow('OEX_PROFILE_INVALID');
 });
 it('retains closed curation and remaps only typed route/annotation bindings',async()=>{
  const e=await fixture(),route=e.navigation[0]!,annotation=e.annotations[0]!;
  e.extensions={[CURATION_NAMESPACE]:{version:1,audioZones:[],transcripts:[],annotationTranslations:[{annotationId:annotation.id,locale:'ko',text:route.id}],routes:[{routeId:route.id,stops:route.waypoints.map((_w,i)=>({waypointIndex:i,title:route.id,description:annotation.id}))}]}};
  expect(()=>checkOexProfile(e)).not.toThrow();const mapped=remapOex(e).exhibition;
  expect(validateViewerCuration(mapped).valid).toBe(true);const c=curationFor(mapped);
  expect(c.routes[0]!.routeId).toBe(mapped.navigation[0]!.id);expect(c.routes[0]!.routeId).not.toBe(route.id);
  expect(c.annotationTranslations[0]!.annotationId).toBe(mapped.annotations[0]!.id);
  expect(c.annotationTranslations[0]!.text).toBe(route.id);expect(c.routes[0]!.stops[0]!.title).toBe(route.id);
  (e.extensions[CURATION_NAMESPACE] as {version:number}).version=2;expect(()=>checkOexProfile(e)).toThrow('OEX_PROFILE_INVALID');
 });

 it('remaps typed scene/material/navigation/experience references but never UUID-shaped prose',async()=>{
  const e=await fixture(),room=e.rooms[0]!,surface=e.surfaces[0]!,placement=e.placements[0]!;
  e.title=room.id;e.artworks[0]!.metadata.description=placement.id;
  e.extensions={
   [MATERIAL_NAMESPACE]:{version:1,surfaces:{[surface.id]:{color:'#ffffff',roughness:1,metalness:0}}},
   [PRESENTATION_NAMESPACE]:{version:1,start:{roomId:room.id,position:[0,1,0],target:[0,1,-1],fov:55},viewpoints:[],credits:[]},
   [EXPERIENCE_NAMESPACE]:{version:1,footsteps:[],voices:[],annotations:[],rooms:[{roomId:room.id,reverb:0.2}],translations:[{placementId:placement.id,locale:'ko',title:room.id,description:placement.id}]},
  };
  const r=remapOex(e);expect(r.exhibition.title).toBe(room.id);expect(r.exhibition.artworks[0]!.metadata.description).toBe(placement.id);
  expect(r.exhibition.rooms[0]!.id).toBe(r.idMap[room.id.toLowerCase()]);
  expect(r.exhibition.surfaces[0]!.roomId).toBe(r.exhibition.rooms[0]!.id);
  expect(r.exhibition.placements[0]!.artworkRevisionId).toBe(r.exhibition.artworks[0]!.revisionId);
  expect(Object.keys((r.exhibition.extensions![MATERIAL_NAMESPACE]as {surfaces:object}).surfaces)).toEqual([r.idMap[surface.id.toLowerCase()]]);
  const x=r.exhibition.extensions![EXPERIENCE_NAMESPACE]as {translations:{placementId:string;title:string;description:string}[]};expect(x.translations[0]!.placementId).toBe(r.exhibition.placements[0]!.id);expect(x.translations[0]!.title).toBe(room.id);expect(x.translations[0]!.description).toBe(placement.id);
  expect(e.rooms[0]!.id).toBe(room.id);
 });
 it('preserves UUID-shaped custom license tokens and authored prose while remapping only typed references',async()=>{
  const e=await fixture(),room=e.rooms[0]!,asset=e.artworks[0]!.assets[0]!;
  e.artworks[0]!.rights.licenseId=room.id;
  e.artworks[0]!.rights.creditLine=asset.id;
  e.artworks[0]!.provenance.events[0]!.description=room.id;
  e.extensions={'org.exhibitos/cc0-license':{scope:room.id,licenseId:'CC0-1.0',text:asset.id}};
  expect(validateExhibition(e)).toEqual({valid:true,errors:[]});
  const r=remapOex(e);expect(r.exhibition.rooms[0]!.id).not.toBe(room.id);
  expect(r.exhibition.artworks[0]!.rights.licenseId).toBe(room.id);
  expect(r.exhibition.artworks[0]!.rights.creditLine).toBe(asset.id);
  expect(r.exhibition.artworks[0]!.provenance.events[0]!.description).toBe(room.id);
  expect(r.exhibition.extensions).toEqual(e.extensions);
  expect(validateExhibition(r.exhibition)).toEqual({valid:true,errors:[]});
 });
 it('materializes shared asset owner aliases with scoped primary/placement/LOD/provenance and scale references',async()=>{
  const e=await fixture(),first=e.artworks[0]!,second=e.artworks[1]!,secondRevision=second.revisionId;
  const shared=first.assets[0]!;second.artworkType=first.artworkType;second.dimensions=structuredClone(first.dimensions);second.assets=structuredClone(first.assets);second.primaryAssetId=first.primaryAssetId;
  for(const p of e.placements)if(p.artworkRevisionId===secondRevision)p.assetId=shared.id;
  for(const a of e.artworks){a.provenance.events[0]!.sourceAssetIds=[shared.id];a.provenance.scaleConversion={sourceUnit:'meter',multiplierToMeters:1,appliedToAssetIds:[shared.id],bakedIntoGeometry:true};a.extensions={'org.exhibitos.viewer/lod':{version:1,variants:[{assetId:shared.id,detail:'full'}]}};}
  expect(validateExhibition(e)).toEqual({valid:true,errors:[]});
  const r=remapOex(e),a=r.exhibition.artworks[0]!,b=r.exhibition.artworks[1]!;
  expect(a.assets[0]!.id).not.toBe(b.assets[0]!.id);expect(a.assets[0]!.path).not.toBe(b.assets[0]!.path);
  for(const artwork of r.exhibition.artworks){expect(artwork.primaryAssetId).toBe(artwork.assets[0]!.id);expect(artwork.provenance.events[0]!.sourceAssetIds).toEqual([artwork.primaryAssetId]);expect(artwork.provenance.scaleConversion!.appliedToAssetIds).toEqual([artwork.primaryAssetId]);}
  for(const p of r.exhibition.placements){const artwork=r.exhibition.artworks.find(x=>x.revisionId===p.artworkRevisionId)!;expect(p.assetId).toBe(artwork.primaryAssetId);}
  expect(r.assetAliases.filter(x=>x.sourceAssetId===shared.id)).toHaveLength(2);expect(r.idMap[shared.id]).toBe(a.primaryAssetId);
  expect(validateExhibition(r.exhibition).valid).toBe(true);
 });
 it('remaps a shared thumbnail id independently for each artwork revision',async()=>{
  const e=await fixture(),preview={id:'f1234567-89ab-4cde-8123-456789abcdef',path:'assets/thumbnail.png',role:'preview' as const,mime:'image/png' as const,bytes:128,sha256:'a'.repeat(64)};
  for(const a of e.artworks){a.assets.push({...preview});a.extensions={...a.extensions,'org.exhibitos.viewer/thumbnail':{version:1,assetId:preview.id}};}
  const approved=structuredClone(e.artworks[0]!);expect(approvedImportedThumbnail(e.artworks[0]!,{importedArtwork:approved})).toBe(true);
  expect(approvedImportedThumbnail(e.artworks[0]!,{})).toBe(false);
  approved.assets.find(x=>x.role==='preview')!.sha256='b'.repeat(64);expect(approvedImportedThumbnail(e.artworks[0]!,{importedArtwork:approved})).toBe(false);
  expect(()=>checkOexProfile(e)).not.toThrow();
  const out=remapOex(e).exhibition;
  for(const a of out.artworks){const selected=a.extensions?.['org.exhibitos.viewer/thumbnail'] as {assetId:string};expect(selected.assetId).toBe(a.assets.find(x=>x.role==='preview')!.id);}
  expect(out.artworks[0]!.assets.find(x=>x.role==='preview')!.id).not.toBe(out.artworks[1]!.assets.find(x=>x.role==='preview')!.id);
  expect(()=>checkOexProfile(out)).not.toThrow();
  e.artworks[0]!.extensions!['org.exhibitos.viewer/thumbnail']={version:1,assetId:e.artworks[0]!.primaryAssetId};
  expect(()=>checkOexProfile(e)).toThrow();
 });
 it('normalizes valid long shared source paths to bounded MIME-specific paths and retains source audit identity',async()=>{
  const e=await fixture(),first=e.artworks[0]!,second=e.artworks[1]!,shared=first.assets[0]!;
  shared.path='assets/'+('x'.repeat(229))+'.glb';
  second.artworkType=first.artworkType;second.dimensions=structuredClone(first.dimensions);second.assets=structuredClone(first.assets);second.primaryAssetId=first.primaryAssetId;
  for(const p of e.placements)if(p.artworkRevisionId===second.revisionId)p.assetId=shared.id;
  expect(shared.path.length).toBe(240);expect(validateExhibition(e)).toEqual({valid:true,errors:[]});
  const r=remapOex(e);expect(validateExhibition(r.exhibition)).toEqual({valid:true,errors:[]});
  for(const a of r.exhibition.artworks){expect(a.assets[0]!.path).toMatch(/^imported\/[a-f0-9-]{36}\/model\.glb$/);expect(a.assets[0]!.path.length).toBeLessThan(240);}
  expect(r.assetAliases.every(a=>a.sourceArtifactPath===shared.path)).toBe(true);
 });
 it('preserves strictly bounded inert public Apache and CC0 notices at exhibition scope only',async()=>{
  const e=await fixture();e.extensions={'org.exhibitos/apache-license':{scope:'Synthetic specification fixture',licenseId:'Apache-2.0',text:'Apache license notice'},'org.exhibitos/cc0-license':{scope:'Synthetic asset bytes',licenseId:'CC0-1.0',text:'CC0 notice'}};
  expect(()=>checkOexProfile(e)).not.toThrow();expect(remapOex(e).exhibition.extensions).toEqual(e.extensions);
  for(const bad of [{scope:'fixture',licenseId:'Apache-2.0',text:'notice',script:'evil'},{scope:'fixture',licenseId:'CC0-1.0',text:'wronglicense'},{scope:'fixture',licenseId:'Apache-2.0',text:{}},{scope:'',licenseId:'Apache-2.0',text:'notice'},{scope:'x'.repeat(513),licenseId:'Apache-2.0',text:'notice'},{scope:'fixture',licenseId:'Apache-2.0',text:'x'.repeat(32769)}]){e.extensions={'org.exhibitos/apache-license':bad as NonNullable<Exhibition['extensions']>[string]};expect(()=>checkOexProfile(e)).toThrow('OEX_LEGAL_NOTICE_INVALID');}
  delete e.extensions;e.artworks[0]!.extensions={'org.exhibitos/apache-license':{scope:'fixture',licenseId:'Apache-2.0',text:'notice'}};expect(()=>checkOexProfile(e)).toThrow('OEX_EXTENSION_UNSUPPORTED');
 });
 it('rejects unknown namespaces on both scene and nested geometry',async()=>{
  const e=await fixture();e.extensions={'com.unreviewed/execution':{url:'https://invalid.example/script'}};expect(()=>checkOexProfile(e)).toThrow('OEX_EXTENSION_UNSUPPORTED');
  delete e.extensions;Object.assign(e.rooms[0]!,{extensions:{'com.unreviewed/execution':{}}});expect(()=>checkOexProfile(e)).toThrow('OEX_PROFILE_INVALID');
 });
 it('rejects malformed archive in a real isolated decoding child',async()=>{await expect(decodeOex(Buffer.from('not a ZIP'))).rejects.toMatchObject({code:'OEX_INVALID'});});
 it('preserves synthetic authorship and omitted image depth in CMS metadata without fabricated dimensions',()=>{
  const metadata={title:'Synthetic painting',description:'Package metadata',dimensions:{width:1,height:2,unit:'m'},rights:{holder:'Synthetic author',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:false,download:false,export:true,commercial:false}},provenance:{source:'synthetic',sourceUnits:'m',scaleApplied:true,notes:'Package import'}};
  expect(validMetadata(metadata)).toBe(true);expect(validMetadata({...metadata,dimensions:{...metadata.dimensions,depth:0}})).toBe(false);
 });
});

it('retains nonidentity approved artifact and placement poses without baking or refitting OEX assets',async()=>{const e=await fixture(),a=e.artworks[0]!;a.transform={position:[1,2,3],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2],scale:[2,1,1]};const before=structuredClone(e);expect(()=>checkOexProfile(e)).not.toThrow();const mapped=remapOex(e).exhibition;expect(mapped.artworks[0]!.transform).toEqual(a.transform);expect(mapped.artworks[0]!.assets.map(x=>[x.bytes,x.sha256])).toEqual(a.assets.map(x=>[x.bytes,x.sha256]));expect(mapped.placements.map(p=>p.transform)).toEqual(e.placements.map(p=>p.transform));expect(e).toEqual(before);});

describe('pinned OEX authority construction',()=>{
 it('adds only an exact optional preview while preserving the original draft and rejects aliases',async()=>{
  const source=await fixture(),before=structuredClone(source),art=source.artworks[0]!,primary=art.assets.find(a=>a.id===art.primaryAssetId)!;
  const pin={artworkId:art.id,revision:art.revision,bindingId:'10000000-0000-4000-8000-000000000010',sourceAssetId:primary.id,sourceSha256:primary.sha256,thumbnailAssetId:'10000000-0000-4000-8000-000000000011',thumbnailSha256:'a'.repeat(64),bytes:100};
  const authority=pinnedAuthoritySnapshot(source,[pin]);expect(source).toEqual(before);expect(authority.artworks[0]!.assets.at(-1)).toMatchObject({id:pin.thumbnailAssetId,sha256:pin.thumbnailSha256,role:'preview'});
  expect(portableOexSnapshot(authority).artworks[0]!.assets).toHaveLength(art.assets.length+1);
  expect(()=>pinnedAuthoritySnapshot(source,[pin,pin])).toThrow('FREEZE_INTEGRITY');
  expect(()=>pinnedAuthoritySnapshot(source,[{...pin,sourceSha256:'b'.repeat(64)}])).toThrow('FREEZE_INTEGRITY');
  expect(()=>pinnedAuthoritySnapshot(source,[{...pin,thumbnailAssetId:primary.id}])).toThrow('FREEZE_INTEGRITY');
 });
});

describe('optional imported preview omission',()=>{
 it('removes only an unreferenced exact preview without altering the source',async()=>{
  const source=await fixture(),art=source.artworks[0]!,preview={id:'f1234567-89ab-4cde-8123-456789abcdef',path:'assets/optional-preview.png',role:'preview' as const,mime:'image/png' as const,bytes:128,sha256:'a'.repeat(64)};
  art.assets.push(preview);art.extensions={...art.extensions,'org.exhibitos.viewer/thumbnail':{version:1,assetId:preview.id}};
  const original=structuredClone(source),item={artworkId:art.id,assetId:preview.id,sha256:preview.sha256},out=withoutImportedPreviews(source,[item]);
  expect(source).toEqual(original);expect(out.artworks[0]!.assets.some(a=>a.id===preview.id)).toBe(false);expect(out.artworks[0]!.extensions?.['org.exhibitos.viewer/thumbnail']).toBeUndefined();
  expect(()=>withoutImportedPreviews(source,[{...item,sha256:'b'.repeat(64)}])).toThrow();expect(()=>withoutImportedPreviews(source,[item,item])).toThrow();
  const pathAlias=structuredClone(source);pathAlias.artworks[1]!.assets[0]!.path=preview.path.toUpperCase();expect(()=>withoutImportedPreviews(pathAlias,[item])).toThrow();
  const aliased=structuredClone(source);aliased.artworks[1]!.assets.push({...preview});aliased.artworks[1]!.extensions={...aliased.artworks[1]!.extensions,'org.exhibitos.viewer/thumbnail':{version:1,assetId:preview.id}};expect(()=>withoutImportedPreviews(aliased,[item])).toThrow();
 });
});

describe('optional OEX archive budget fallback',()=>{
 it('retries without optional assets when packaging rejects overhead and preserves other errors',async()=>{
  let hasOptional=true,calls=0;const write=async()=>{calls++;if(hasOptional)throw Object.assign(new Error('limit'),{code:'ZIP_ARCHIVE_LIMIT'});return Buffer.from('required');};
  expect((await writeOexWithinBudget(write,()=>{hasOptional=false;})).toString()).toBe('required');expect(calls).toBe(2);
  let included=true;expect((await writeOexWithinBudget(async()=>{if(included)throw Object.assign(new Error('limit'),{code:'JSON_DOCUMENT_LIMIT'});return Buffer.from('required');},()=>{included=false;})).toString()).toBe('required');
  await expect(writeOexWithinBudget(async()=>{throw Object.assign(new Error('invalid'),{code:'ASSET_SIZE_MISMATCH'});},()=>{throw Error('must not drop');})).rejects.toMatchObject({code:'OEX_INVALID'});
  await expect(writeOexWithinBudget(async()=>{throw Object.assign(new Error('limit'),{code:'ZIP_ARCHIVE_LIMIT'});})).rejects.toMatchObject({code:'OEX_LIMIT'});
 });
});
