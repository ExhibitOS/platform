// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FLOOR_NAMESPACE,floorPresetDefaults} from '@exhibitos/studio-contract';
import type {PublicPublication} from '../publication-client';
import {BUILTIN_STEP_BANKS,BUILTIN_STEP_BYTES,resolveFootsteps} from './footstep-bank';
import {verifyPcmWav} from './audio';
const room='11111111-1111-4111-8111-111111111111',surface='22222222-2222-4222-8222-222222222222';
function doc(preset:'wood'|'tile'|'carpet'|'marble',sound:unknown={mode:'material-default',gain:.4}){
 return {surfaces:[{id:surface,type:'floor',roomId:room}],extensions:{'org.exhibitos.viewer/footstep-resources':{version:1,families:['carpet','concrete','marble','tile','wood']},[FLOOR_NAMESPACE]:{version:1,bindings:[{...floorPresetDefaults(preset),target:{kind:'surface',surfaceId:surface},sound}]}}} as unknown as PublicPublication['exhibition'];
}
describe('approved material footsteps',()=>{
 it('pins actual bounded PCM bytes for every approved family',async()=>{
  const ids=Object.values(BUILTIN_STEP_BANKS).flat();expect(new Set(ids).size).toBe(11);
  for(const id of ids){
   const bytes=await readFile(new URL(`../../public/footstep-samples/v1/${id}.wav`,import.meta.url));
   expect(bytes.length).toBe(BUILTIN_STEP_BYTES[id]);expect(createHash('sha256').update(bytes).digest('hex')).toBe(id);
   const pcm=verifyPcmWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
   expect(pcm.duration).toBeGreaterThanOrEqual(.04);expect(pcm.duration).toBeLessThanOrEqual(1.5);
  }
 });
 it('chooses only the matching approved bank and never treats tile as marble',()=>{
  for(const preset of ['wood','tile','carpet','marble'] as const)expect(resolveFootsteps(doc(preset),room,surface,undefined)).toEqual({kind:'builtin',ids:BUILTIN_STEP_BANKS[preset],gain:.4,material:preset});
 });
 it('honours none, explicit media and legacy authored entries',()=>{
  expect(resolveFootsteps(doc('wood',{mode:'none',gain:1}),room,surface,undefined).kind).toBe('none');
  expect(resolveFootsteps(doc('wood',{mode:'explicit',gain:.2,assetIds:['id']}),room,surface,undefined)).toEqual({kind:'publication',ids:['id'],gain:.2,material:'wood'});
  expect(resolveFootsteps(doc('wood'),room,surface,{surfaceId:surface,material:'stone',assetId:'custom'})).toEqual({kind:'publication',ids:['custom'],gain:.4,material:'stone'});
  const legacy={surfaces:[],extensions:{'org.exhibitos.viewer/footstep-resources':{version:1,families:['concrete']}}} as unknown as PublicPublication['exhibition'];
  expect(resolveFootsteps(legacy,room,surface,{surfaceId:surface,material:'concrete'})).toEqual({kind:'builtin',ids:BUILTIN_STEP_BANKS.concrete,gain:1,material:'concrete'});
  expect(resolveFootsteps(legacy,room,surface,{surfaceId:surface,material:'wood',assetId:'custom'})).toEqual({kind:'publication',ids:['custom'],gain:1,material:'wood'});
  const old={surfaces:[],extensions:{}} as unknown as PublicPublication['exhibition'];
  expect(resolveFootsteps(old,room,surface,{surfaceId:surface,material:'concrete'})).toEqual({kind:'procedural',gain:1,material:'concrete'});
 });
});
