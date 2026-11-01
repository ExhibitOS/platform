// SPDX-License-Identifier: AGPL-3.0-or-later
import {LinearSRGBColorSpace,type Light} from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {GeometryCommand} from './model';

/** Apply only temporary authored-light colors to existing Three.js lights.
 * The committed document and the fixture geometry remain untouched. */
export function syncPreviewLightColors(lights:ReadonlyMap<string,{light:Light}>,document:Exhibition,preview:GeometryCommand|null|undefined,previewLightId?:string):boolean{
 const candidate=preview?.type==='replace-architecture'&&previewLightId&&preview.candidate.id===document.id&&preview.candidate.revisionId===document.revisionId?preview.candidate:undefined;
 let changed=false;
 for(const original of document.lights){
  const target=lights.get(original.id)?.light;if(!target)continue;
  const replacement=original.id===previewLightId?candidate?.lights.find(value=>value.id===original.id):undefined;
  const valid=(value:unknown):value is [number,number,number]=>Array.isArray(value)&&value.length===3&&value.every(n=>typeof n==='number'&&Number.isFinite(n));
  const color=valid(replacement?.color)?replacement.color:original.color;
  if(!valid(color))continue;
  if(target.color.r===color[0]&&target.color.g===color[1]&&target.color.b===color[2])continue;
  target.color.setRGB(color[0]!,color[1]!,color[2]!,LinearSRGBColorSpace);changed=true;
 }
 return changed;
}
