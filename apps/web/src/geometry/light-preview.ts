// SPDX-License-Identifier: AGPL-3.0-or-later
import {LinearSRGBColorSpace,type Light} from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {GeometryCommand} from './model';
import {LIGHT_DETAILS_NAMESPACE,TEMPLATE_NAMESPACE,validateStudioLightDetails} from '@exhibitos/studio-contract';

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
 if(!validateStudioLightDetails(before).valid||!validateStudioLightDetails(after).valid)return false;
 try{
  const normalize=(doc:Exhibition)=>{
   const copy=structuredClone(doc),target=copy.lights[i]!.id.toLowerCase();
   copy.lights[i]!.color=[0,0,0];
   const extensions=copy.extensions as Record<string,unknown>|undefined;
   if(extensions){
    const details=extensions[LIGHT_DETAILS_NAMESPACE] as {version:1;lights:Record<string,unknown>[]}|undefined;
    if(details){
     details.lights=details.lights.flatMap(entry=>{
      if(typeof entry.lightId!=='string'||entry.lightId.toLowerCase()!==target)return [entry];
      const next={...entry};delete next.temperatureKelvin;
      return next.fixture==='none'&&Object.keys(next).length===2?[]:[next];
     });
     if(!details.lights.length)delete extensions[LIGHT_DETAILS_NAMESPACE];
    }
    const template=extensions[TEMPLATE_NAMESPACE] as {modified?:unknown}|undefined;
    if(template&&typeof template.modified==='boolean')template.modified=false;
    if(!Object.keys(extensions).length)delete copy.extensions;
   }
   return copy;
  };
  const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)])):value;
  return JSON.stringify(canonical(normalize(before)))===JSON.stringify(canonical(normalize(after)));
 }catch{return false;}
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
