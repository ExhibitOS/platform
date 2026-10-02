// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {fixtureURL,validateExhibition,type Exhibition} from '@exhibitos/spec';
import {MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE,EXPERIENCE_NAMESPACE} from '@exhibitos/studio-contract';
import {checkOexProfile,remapOex,decodeOex} from './oex.ts';
import {validMetadata} from './cms.ts';
async function fixture(){return JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8'))as Exhibition;}
describe('OEX service boundaries',()=>{
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
