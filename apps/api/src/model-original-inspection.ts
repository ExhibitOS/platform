// SPDX-License-Identifier: AGPL-3.0-or-later
import {ApiError} from './api-error.ts';
import {COMPACT_MODEL_LIMITS,COMPACT_MODEL_RECIPE,inspectCompactModelSource,modelPreparationHash} from './oam-original-preparation.ts';
/** Read-only structural admission. No source unit, image decode, derived output,
 * custody or approval is inferred from this result. */
export function inspectModelOriginal(bytes:Buffer){
 if(!Buffer.isBuffer(bytes)||bytes.length<28||bytes.length>COMPACT_MODEL_LIMITS.sourceBytes)throw new ApiError(422,'MODEL_PREPARATION_PROFILE_UNSUPPORTED');
 const original={mime:'model/gltf-binary' as const,sha256:modelPreparationHash(bytes),bytes:bytes.length};
 try{
  const source=inspectCompactModelSource(bytes,original);
  return {version:1 as const,profileId:COMPACT_MODEL_RECIPE.id,original,rawBounds:source.bounds,triangles:source.indices.length/3,vertices:source.vertices,sourceUnits:'unknown' as const,qualification:'structure-only' as const};
 }catch{throw new ApiError(422,'MODEL_PREPARATION_PROFILE_UNSUPPORTED');}
}
