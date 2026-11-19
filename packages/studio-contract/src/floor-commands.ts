// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {WORKSPACE_MATERIAL_NAMESPACE, type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {EXPERIENCE_NAMESPACE, experienceFor, experienceFootstepFor} from './experience.js';
import {declareFootstepFamily} from './footstep-bank.js';
import {FLOOR_NAMESPACE,floorFor,floorTargetKey,validateStudioFloors,type StudioFloors,floorMaterial,floorPresetDefaults,floorSoundFamily,type FloorBinding,type FloorPreset,type FloorTarget} from './floors.js';
import type {PbrMaterial} from './pbr-material.js';
import type {StudioMaterials} from './index.js';
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


const recordedStockPresets: Readonly<Partial<Record<NonNullable<FloorBinding['texturePack']>['id'], FloorPreset>>> = {
 WoodFloor051: 'wood', 'quiet-oak-herringbone': 'wood', Tiles074: 'tile', Marble006: 'marble', Carpet004: 'carpet',
};

export type RecordedFloorCommand =
 | {type: 'select-floor-material'; target: FloorTarget; preset: FloorPreset}
 | {type: 'reset-floor-sound'; target: FloorTarget};

/** Whole stock selection is separate from the appearance-only authoring path.
 * Pre-existing explicit and mute choices keep their saved values on selection. */
export function applyRecordedFloorCommand(document: Exhibition, command: RecordedFloorCommand): Exhibition {
 const target = command.target;
 const surface = target.kind === 'surface' ? document.surfaces.find(row => row.type === 'floor' && row.id.toLowerCase() === target.surfaceId.toLowerCase()) : undefined;
 const roomKey = (target.kind === 'room-base' ? target.roomId : surface?.roomId)?.toLowerCase();
 const room = document.rooms.find(row => row.id.toLowerCase() === roomKey);
 if (!room || target.kind === 'room-base' && document.surfaces.some(row => row.type === 'floor' && row.roomId.toLowerCase() === roomKey))
  throw Error('FLOOR_TARGET_INVALID');
 const workspace = document.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings | undefined;
 const custom = surface && workspace?.bindings.some(row => row.surfaceId.toLowerCase() === surface.id.toLowerCase());
 if (custom && command.type === 'select-floor-material') throw Error('FLOOR_RECORDING_UNASSIGNED');
 if (!validateStudioFloors(document).valid) throw Error('FLOOR_SETTINGS_INVALID');
 const current = floorFor(document, {roomId: room.id, surfaceId: surface?.id});
 const experience = experienceFor(document);
 const legacy = experienceFootstepFor(experience, surface?.id);
 const hasLegacyRecording = legacy?.assetId !== undefined || legacy?.bank !== undefined;
 const reset = command.type === 'reset-floor-sound';
 const currentMaterial = !custom && current && (current.texturePack ? recordedStockPresets[current.texturePack.id] : current.preset);
 let binding: FloorBinding | undefined;
 if (!reset) {
  if (!['wood','marble','tile','carpet'].includes(command.preset)) throw Error('FLOOR_SETTINGS_INVALID');
  const savedTarget = current?.target ?? (surface ? {kind:'surface', surfaceId:surface.id} : {kind:'room-base', roomId:room.id});
  binding = createFloorPreset(savedTarget, command.preset);
  if (current?.sound) binding.sound = current.sound;
  else if (hasLegacyRecording) delete binding.sound;
 } else if (current && currentMaterial) {
  const materials = document.extensions?.['org.exhibitos.studio/materials'] as unknown as StudioMaterials | undefined;
  const legacyMaterial = surface && materials?.surfaces[surface.id];
  binding = applyFloorPreset(current, currentMaterial, ['sound'], legacyMaterial);
 } else if (current) {
  binding = current;
  delete binding.sound;
 }
 const next = structuredClone(document);
 if (binding) {
  const prior = next.extensions?.[FLOOR_NAMESPACE] as unknown as StudioFloors | undefined;
  const bindings = prior?.bindings ?? [];
  const index = bindings.findIndex(row => floorTargetKey(row.target) === floorTargetKey(target));
  if (index < 0) bindings.push(binding);
  else bindings[index] = binding;
  next.extensions = {...next.extensions, [FLOOR_NAMESPACE]: {version: 1, bindings} as unknown as NonNullable<Exhibition['extensions']>[string]};
 }
 // Reset retires only this target's previous override. The approved media and
 // prior revision remain in custody. Custom or unmapped materials stay silent.
 if (reset && legacy && (!currentMaterial || hasLegacyRecording)) {
  if (!currentMaterial) experience.footsteps = experience.footsteps.filter(row => row !== legacy);
  else {
   delete legacy.assetId;
   delete legacy.bank;
  }
  next.extensions = {...next.extensions, [EXPERIENCE_NAMESPACE]: experience as unknown as NonNullable<Exhibition['extensions']>[string]};
 }
 if ((reset || !hasLegacyRecording) && binding?.sound?.mode === 'material-default')
  declareFootstepFamily(next, binding.preset);
 if (!validateStudioFloors(next).valid) throw Error('FLOOR_SETTINGS_INVALID');
 return next;
}
