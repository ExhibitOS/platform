// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {EXPERIENCE_NAMESPACE,experienceFor,validateViewerExperience} from './experience.js';
async function fixture(){const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;const placement=e.placements[0]!;e.extensions={[EXPERIENCE_NAMESPACE]:{version:1,footsteps:[],voices:[],annotations:[{annotationId:e.annotations[0]!.id,position:[0,0,0]}],rooms:[{roomId:e.rooms[0]!.id,reverb:0.2}],translations:[{placementId:placement.id,locale:'ko',title:'번역 제목',description:'번역 설명'}]}};return e;}
describe('experience reference boundaries',()=>{
 it('recorded step bank accepts bounded WAV references and preserves legacy bindings while rejecting ambiguous banks',async()=>{
  const e=await fixture(),floor=e.surfaces[0]!,a='60000000-0000-4000-8000-000000000001',b='60000000-0000-4000-8000-000000000002';floor.type='floor';
  e.mediaAssets=[{id:a,mime:'audio/wav'},{id:b,mime:'audio/wav'}] as Exhibition['mediaAssets'];
  const x=experienceFor(e);x.footsteps=[{surfaceId:floor.id,material:'wood',bank:[{assetId:a},{assetId:b.toUpperCase()}]}];e.extensions={[EXPERIENCE_NAMESPACE]:x};
  expect(validateViewerExperience(e).valid).toBe(true);const copy=experienceFor(e);copy.footsteps[0]!.bank![0]!.assetId='changed';expect(experienceFor(e).footsteps[0]!.bank![0]!.assetId).toBe(a);
  for(const bank of [[],[{assetId:a}],Array.from({length:17},()=>({assetId:a})),[{assetId:a},{assetId:a.toUpperCase()}],[{assetId:a},{assetId:'missing'}],[{assetId:a},{assetId:b,unknown:true}]]){
   x.footsteps=[{surfaceId:floor.id,material:'wood',bank}];e.extensions={[EXPERIENCE_NAMESPACE]:x};expect(validateViewerExperience(e).valid).toBe(false);
  }
  x.footsteps=[{surfaceId:floor.id,material:'wood',assetId:a,bank:[{assetId:a},{assetId:b}]}];expect(validateViewerExperience(e).valid).toBe(false);
  delete x.footsteps[0]!.bank;expect(validateViewerExperience(e).valid).toBe(true);delete x.footsteps[0]!.assetId;expect(validateViewerExperience(e).valid).toBe(true);
  x.footsteps[0]!.bank=[{assetId:a},{assetId:b}];e.mediaAssets[1]!.mime='audio/mpeg';expect(validateViewerExperience(e).valid).toBe(false);
 });
 it('preserves absent extension compatibility and returns a detached default',()=>{const e={};const first=experienceFor(e);first.rooms.push({roomId:'x',reverb:1});expect(experienceFor(e).rooms).toEqual([]);expect(validateViewerExperience(e).valid).toBe(true);});
 it('qualifies model-local centered annotation, reverb and translation',async()=>{const e=await fixture();expect(validateViewerExperience(e).valid).toBe(true);const x=experienceFor(e);x.rooms[0]!.roomId=x.rooms[0]!.roomId.toUpperCase();e.extensions={[EXPERIENCE_NAMESPACE]:x};expect(validateViewerExperience(e).valid).toBe(true);});
 it('rejects unknown fields, reference spoof, duplicate locales and outside-model anchor',async()=>{const e=await fixture();const x=experienceFor(e);x.annotations[0]!.position=[1000,0,0];e.extensions={[EXPERIENCE_NAMESPACE]:x};expect(validateViewerExperience(e).valid).toBe(false);x.annotations[0]!.position=[0,0,0];x.translations.push({...x.translations[0]!,locale:'KO'});expect(validateViewerExperience(e).valid).toBe(false);x.translations.pop();x.rooms[0]!.roomId='10000000-0000-4000-8000-000000000000';expect(validateViewerExperience(e).valid).toBe(false);});
});
