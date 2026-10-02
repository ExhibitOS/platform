// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
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
