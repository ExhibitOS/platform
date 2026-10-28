// SPDX-License-Identifier: AGPL-3.0-or-later
import {floorMaterial,floorPresetDefaults,floorSoundFamily,type FloorBinding,type FloorPreset,type FloorTarget} from './floors.js';
import type {PbrMaterial} from './pbr-material.js';
export type FloorApplyField='color'|'roughness'|'metalness'|'repeatMeters'|'rotation'|'texturePack'|'normalScale'|'aoStrength'|'sound';
const appearance=['color','roughness','metalness','repeatMeters','rotation','texturePack','normalScale','aoStrength'] as const;
/** Explicit whole-preset creation; callers must first present customized legacy fields for selection. */
export function createFloorPreset(target:FloorTarget,preset:FloorPreset):FloorBinding {return {target:structuredClone(target),...floorPresetDefaults(preset)};}
/** Apply an explicit reviewed scope. Never infer customization from equal numerical values. */
export function applyFloorPreset(current:FloorBinding,preset:FloorPreset,fields:readonly FloorApplyField[],legacyMaterial?:PbrMaterial):FloorBinding {
 const selected=new Set(fields);
 if(selected.size!==fields.length||fields.some(f=>![...appearance,'sound'].includes(f)))throw Error('FLOOR_APPLY_SCOPE');
 const result=structuredClone(current);if(!selected.size)return result;
 const desired=floorPresetDefaults(preset),oldDefaults=floorPresetDefaults(current.preset),oldMaterial=floorMaterial(current,legacyMaterial);
 // A partial appearance change cannot silently switch an inherited footstep family.
 const keepBase=!selected.has('sound')&&current.sound?.mode==='material-default'&&floorSoundFamily(current.preset)!==floorSoundFamily(preset);
 if(!keepBase&&appearance.some(f=>selected.has(f))||selected.has('sound'))result.preset=preset;
 const baseChanged=result.preset!==current.preset;
 for(const field of appearance){
  const replace=selected.has(field);
  if(!replace&&!baseChanged)continue;
  if(field==='color'||field==='roughness'||field==='metalness'){
   result.materialOverride={...result.materialOverride,[field]:replace?desired.materialOverride![field]:oldMaterial[field]};
  }else if(field==='repeatMeters'){result.repeatMeters=[...(replace?desired.repeatMeters:current.repeatMeters)];}
  else if(field==='rotation'){result.rotation=replace?desired.rotation:current.rotation;}
  else if(field==='texturePack'){result.texturePack=structuredClone(replace?desired.texturePack!:current.texturePack??oldDefaults.texturePack!);}
  else if(field==='normalScale'){result.normalScale=replace?desired.normalScale!:current.normalScale??oldDefaults.normalScale!;}
  else {result.aoStrength=replace?desired.aoStrength!:current.aoStrength??oldDefaults.aoStrength!;}
 }
 if(selected.has('sound'))result.sound=structuredClone(desired.sound!);
 return result;
}
/** Reset writes defaults of the persisted preset. Removing a binding is a separate legacy restoration. */
export function resetFloorFields(current:FloorBinding,fields:readonly FloorApplyField[]):FloorBinding {return applyFloorPreset(current,current.preset,fields);}
