// SPDX-License-Identifier: AGPL-3.0-or-later
import {LinearSRGBColorSpace,type Light} from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {GeometryCommand} from './model';

/** Conservative equivalence for retaining an editor scene across one light-color edit. */
export function onlyLightColorChanged(before:Exhibition,after:Exhibition):boolean{
 if(before.lights.length!==after.lights.length)return false;
 const changed:number[]=[];
 for(let i=0;i<before.lights.length;i++){
  const a=before.lights[i],b=after.lights[i];
  if(!a||!b||a.id!==b.id)return false;
  if(JSON.stringify(a.color)!==JSON.stringify(b.color))changed.push(i);
 }
 if(changed.length!==1)return false;
 const i=changed[0]!;
 const valid=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
 if(!valid(before.lights[i]!.color)||!valid(after.lights[i]!.color))return false;
 const omit=(doc:Exhibition)=>({...doc,lights:doc.lights.map((light,index)=>index===i?{...light,color:null}:light)});
 try{return JSON.stringify(omit(before))===JSON.stringify(omit(after));}catch{return false;}
}

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
