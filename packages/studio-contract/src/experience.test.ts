// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {EXPERIENCE_NAMESPACE,experienceFor,validateViewerExperience} from './experience.js';
async function fixture(){const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;const placement=e.placements[0]!;e.extensions={[EXPERIENCE_NAMESPACE]:{version:1,footsteps:[],voices:[],annotations:[{annotationId:e.annotations[0]!.id,position:[0,0,0]}],rooms:[{roomId:e.rooms[0]!.id,reverb:0.2}],translations:[{placementId:placement.id,locale:'ko',title:'번역 제목',description:'번역 설명'}]}};return e;}
describe('experience reference boundaries',()=>{
 it('preserves absent extension compatibility and returns a detached default',()=>{const e={};const first=experienceFor(e);first.rooms.push({roomId:'x',reverb:1});expect(experienceFor(e).rooms).toEqual([]);expect(validateViewerExperience(e).valid).toBe(true);});
 it('qualifies model-local centered annotation, reverb and translation',async()=>{const e=await fixture();expect(validateViewerExperience(e).valid).toBe(true);const x=experienceFor(e);x.rooms[0]!.roomId=x.rooms[0]!.roomId.toUpperCase();e.extensions={[EXPERIENCE_NAMESPACE]:x};expect(validateViewerExperience(e).valid).toBe(true);});
 it('rejects unknown fields, reference spoof, duplicate locales and outside-model anchor',async()=>{const e=await fixture();const x=experienceFor(e);x.annotations[0]!.position=[1000,0,0];e.extensions={[EXPERIENCE_NAMESPACE]:x};expect(validateViewerExperience(e).valid).toBe(false);x.annotations[0]!.position=[0,0,0];x.translations.push({...x.translations[0]!,locale:'KO'});expect(validateViewerExperience(e).valid).toBe(false);x.translations.pop();x.rooms[0]!.roomId='10000000-0000-4000-8000-000000000000';expect(validateViewerExperience(e).valid).toBe(false);});
});
