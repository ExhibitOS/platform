// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {furnishingsFor,lightDetailsFor,type ExhibitionLight} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';
import {readFurnishingBytes} from './furnishing-assets.ts';

function resolveFixtures(scene:Exhibition){
 const details=new Map(lightDetailsFor(scene).map(row=>[row.lightId.toLowerCase(),row]));
 const furnishings=furnishingsFor(scene);
 const bindings=new Map(furnishings?.bindings.filter(row=>row.hostKind==='light').map(row=>[row.hostId.toLowerCase(),row]));
 const assets=new Map(furnishings?.assets.map(asset=>[asset.id.toLowerCase(),asset]));
 return (light:ExhibitionLight)=>{
  const detail=details.get(light.id.toLowerCase());
  const binding=bindings.get(light.id.toLowerCase());
  if(binding){const asset=assets.get(binding.assetId.toLowerCase());return asset&&{kind:'model' as const,asset};}
  if(light.type==='area'&&detail?.purpose==='room-base')return {kind:'room-area' as const};
  if(detail?.fixture==='spot-can'||detail?.fixture==='disc'||detail?.fixture==='panel')return {kind:'built-in' as const};
 };
}

/** Call after whole-scene structural validation. Retained unresolved legacy
 * fixtures are readable and can be removed/repaired; only new admission and
 * transitions from a qualified fixture are fenced here. */
export async function assertLightFixtureDelta(before:Exhibition|undefined,after:Exhibition){
 const priorLights=new Map(before?.lights.map(light=>[light.id.toLowerCase(),light]));
 const previous=before&&resolveFixtures(before),proposed=resolveFixtures(after);
 const verified=new Set<string>();
 for(const light of after.lights){
  const id=light.id.toLowerCase(),prior=priorLights.get(id),old=prior&&previous?.(prior);
  const current=proposed(light);
  if(!current&&(!prior||prior.type!==light.type||old))throw new ApiError(422,'LIGHT_FIXTURE_REQUIRED');
  if(current?.kind!=='model'||old?.kind==='model'&&old.asset.sha256===current.asset.sha256||verified.has(current.asset.sha256))continue;
  try{
   await readFurnishingBytes(current.asset,'model');
   await readFurnishingBytes(current.asset,'notice');
  }catch{throw new ApiError(422,'LIGHT_FIXTURE_SOURCE_UNAVAILABLE');}
  verified.add(current.asset.sha256);
 }
}
