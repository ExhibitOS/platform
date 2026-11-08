// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import type {Artwork,Exhibition} from '@exhibitos/spec';
import {replaceArtworkReferences} from './artwork-snapshot-replacement.js';
type OrdinaryArtwork=Extract<Artwork,{schemaVersion:'1.0.0-draft.1'}>;
const old={id:'art',revisionId:'revision-old',revision:1,artworkType:'image',primaryAssetId:'primary-old',assets:[{id:'primary-old'},{id:'coarse-old'}]} as OrdinaryArtwork;
const next={...old,revisionId:'revision-new',revision:2,primaryAssetId:'primary-new',assets:[{id:'primary-new'},{id:'coarse-new'}]} as OrdinaryArtwork;
const fixture=()=>({artworks:[old],placements:[{id:'placement',roomId:'room',artworkRevisionId:old.revisionId,assetId:old.primaryAssetId,transform:{position:[0,1,2]}},{id:'other',roomId:'room',artworkRevisionId:'other-rev',assetId:'other-asset'}],extensions:{route:{targetPlacementId:'placement'}}}) as unknown as Exhibition;
describe('replace artwork references',()=>{
 it('retains placement and route identity and does not mutate the source',()=>{const original=fixture(),out=replaceArtworkReferences(original,old,next);expect(out.placements[0]).toMatchObject({id:'placement',roomId:'room',artworkRevisionId:'revision-new',assetId:'primary-new',transform:{position:[0,1,2]}});expect(out.placements[1]).toEqual(original.placements[1]);expect(out.extensions).toEqual(original.extensions);expect(original.placements[0]!.assetId).toBe('primary-old');});
 it('rejects stale snapshot and unhandled old cover or secondary asset references',()=>{const stale=fixture();stale.artworks[0]={...old,revision:2};expect(()=>replaceArtworkReferences(stale,old,next)).toThrow('ARTWORK_REPLACEMENT_STALE');const cover=fixture();cover.extensions={cover:{imageAssetId:'primary-old'}};expect(()=>replaceArtworkReferences(cover,old,next)).toThrow('ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');const secondary=fixture();secondary.placements[0]!.assetId='coarse-old';expect(()=>replaceArtworkReferences(secondary,old,next)).toThrow('ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');});
});

it('updates multiple placements, accepts reordered equal keys and rejects old keyed references',()=>{const source=fixture();source.artworks[0]=Object.fromEntries(Object.entries(old).reverse()) as Artwork;source.placements.push({...source.placements[0]!,id:'second'});expect(replaceArtworkReferences(source,old,next).placements.filter(p=>p.assetId==='primary-new')).toHaveLength(2);source.extensions={references:{'coarse-old':{note:'not rebound'}}};expect(()=>replaceArtworkReferences(source,old,next)).toThrow('ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');});

it('rejects collisions with unrelated artwork assets and revision identities',()=>{const source=fixture();(source.artworks as Artwork[]).push({...old,id:'unrelated',revisionId:'other-rev',primaryAssetId:'other-asset',assets:[{id:'other-asset'}]} as Artwork);expect(()=>replaceArtworkReferences(source,old,{...next,revisionId:'other-rev'})).toThrow('ARTWORK_REPLACEMENT_INVALID');expect(()=>replaceArtworkReferences(source,old,{...next,primaryAssetId:'other-asset',assets:[{id:'other-asset'}]} as Artwork)).toThrow('ARTWORK_REPLACEMENT_INVALID');});

it('rejects old identifiers embedded in structured paths instead of silently rebinding',()=>{const source=fixture();source.extensions={reference:{path:'/assets/primary-old/image.png'}};expect(()=>replaceArtworkReferences(source,old,next)).toThrow('ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');});

it('rebinds the existing entrance primary while retaining authored entrance settings',()=>{const source=fixture();source.extensions={'org.exhibitos.viewer/entrance':{version:1,imageAssetId:'primary-old',imageAlt:'painting',mobilePosition:'top'}};const out=replaceArtworkReferences(source,old,next);expect(out.extensions?.['org.exhibitos.viewer/entrance']).toEqual({version:1,imageAssetId:'primary-new',imageAlt:'painting',mobilePosition:'top'});expect((source.extensions?.['org.exhibitos.viewer/entrance'] as {imageAssetId:string}).imageAssetId).toBe('primary-old');});

describe('replace a placement with an independently approved model candidate',()=>{
 const prior:OrdinaryArtwork={...old,schemaVersion:'1.0.0-draft.1',units:'meter',coordinates:'right-handed-y-up',artworkType:'sculpture',id:'retired-model-id'};
 const candidate:OrdinaryArtwork={...next,schemaVersion:'1.0.0-draft.1',units:'meter',coordinates:'right-handed-y-up',artworkType:'sculpture',id:'candidate-artwork',revision:1};
 function draft(){const source=fixture();source.artworks[0]=prior;return source;}

 it('adopts the candidate snapshot and changes only the selected placement references',()=>{
  const source=draft(),before=structuredClone(source),expected=structuredClone(source);
  expected.artworks[0]=candidate;
  Object.assign(expected.placements[0]!,{artworkRevisionId:candidate.revisionId,assetId:candidate.primaryAssetId});
  expect(replaceArtworkReferences(source,prior,candidate,'placement')).toEqual(expected);
  expect(source).toEqual(before);
 });

 it('refuses a different placement, additional old references, duplicate candidate, or changed model pose',()=>{
  const source=draft();
  expect(()=>replaceArtworkReferences(source,prior,candidate,'other')).toThrow('ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
  expect(()=>replaceArtworkReferences(source,prior,{...candidate,transform:{position:[1,0,0],rotation:[0,0,0,1],scale:[1,1,1]}},'placement')).toThrow('ARTWORK_REPLACEMENT_INVALID');
  source.artworks.push(candidate);
  expect(()=>replaceArtworkReferences(source,prior,candidate,'placement')).toThrow('ARTWORK_REPLACEMENT_INVALID');
  source.artworks.pop();
  source.extensions={unsupported:{artworkId:prior.id}};
  expect(()=>replaceArtworkReferences(source,prior,candidate,'placement')).toThrow('ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
  delete source.extensions;
  source.placements.push({...source.placements[0]!,id:'second'});
  expect(()=>replaceArtworkReferences(source,prior,candidate,'placement')).toThrow('ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
 });
});
