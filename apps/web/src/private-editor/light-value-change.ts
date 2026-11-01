import type {Exhibition} from '@exhibitos/spec';
import {freezeCanonical,TEMPLATE_NAMESPACE,lightDetailsFor} from '@exhibitos/studio-contract';
import {onlyLightColorChanged} from '../geometry/light-preview';
/** Preserve unrelated legacy geometry while proving no spatial field changed. */
export function onlyPrivateLightValuesChanged(before:Exhibition,after:Exhibition):boolean{
 if(before.lights.length!==after.lights.length)return false;
 const changed=before.lights.flatMap((light,index)=>{
  const next=after.lights[index];if(!next||next.id!==light.id)return [index];
  return freezeCanonical(light.color)!==freezeCanonical(next.color)||light.intensity!==next.intensity?[index]:[];
 });
 if(changed.length>1)return false;const base=structuredClone(before);
 if(changed.length){const index=changed[0]!,old=base.lights[index]!,next=after.lights[index];if(!next||next.id!==old.id||!Number.isFinite(next.intensity)||next.intensity<0||next.intensity>1000000)return false;const other=(doc:Exhibition)=>lightDetailsFor(doc).filter(value=>value.lightId.toLowerCase()!==old.id.toLowerCase());if(freezeCanonical(other(before))!==freezeCanonical(other(after)))return false;old.intensity=next.intensity;}
 if(onlyLightColorChanged(base,after))return true;
 const withoutModified=(document:Exhibition)=>{const value=structuredClone(document),template=value.extensions?.[TEMPLATE_NAMESPACE] as unknown as {modified?:unknown}|undefined;if(template&&typeof template.modified==='boolean')template.modified=false;return value;};
 return freezeCanonical(withoutModified(base))===freezeCanonical(withoutModified(after));
}
