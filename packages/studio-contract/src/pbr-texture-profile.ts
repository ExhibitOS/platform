// SPDX-License-Identifier: AGPL-3.0-or-later
export type PbrTextureRole = 'colour' | 'normal' | 'occlusion' | 'metallicRoughness';
export interface PbrTextureBinding {
  index: number;
  texCoord: 0;
  role: PbrTextureRole;
  scale?: number;
  strength?: number;
}
const profiles = {
  colour: { parameter: undefined, max: 1 },
  normal: { parameter: 'scale', max: 2 },
  occlusion: { parameter: 'strength', max: 1 },
  metallicRoughness: { parameter: undefined, max: 1 },
} as const;
const reject = (): never => { throw Error('PBR_TEXTURE_PROFILE_INVALID'); };
/** Normalize a supported glTF texture-info tuple without rewriting source bytes.
 * This validates tuples only. Callers must retain safe PNG decoding, image MIME/
 * linear-alias rules, payload/UV budgets and exact approved-LOD scale/strength
 * binding. The internal role field must never be serialized into glTF texture-info.
 */
export function pbrTextureBinding(value: unknown, role: PbrTextureRole, textureCount: number): PbrTextureBinding {
  if (!Number.isSafeInteger(textureCount) || textureCount < 1 || textureCount > 8 ||
      !Object.hasOwn(profiles, role) || !value || typeof value !== 'object' || Array.isArray(value)) return reject();
  const item = value as Record<string, unknown>, profile = profiles[role];
  const allowed = ['index', 'texCoord', ...(profile.parameter ? [profile.parameter] : [])];
  if (Object.keys(item).some(key => !allowed.includes(key)) || !Object.hasOwn(item, 'index') ||
      typeof item.index !== 'number' || !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= textureCount ||
      (Object.hasOwn(item, 'texCoord') && item.texCoord !== 0)) return reject();
  const result: PbrTextureBinding = { index: item.index, texCoord: 0, role };
  if (profile.parameter) {
    const scalar = Object.hasOwn(item, profile.parameter) ? item[profile.parameter] : 1;
    if (typeof scalar !== 'number' || !Number.isFinite(scalar) || scalar < 0 || scalar > profile.max) return reject();
    result[profile.parameter] = scalar;
  }
  return result;
}
export const pbrTextureIsLinear = (role: PbrTextureRole) => role !== 'colour';

/** Structural resource bound for ordinary full-only RGB base/normal/AO models.
 * This is not provenance, a producer receipt, or approved-LOD authority. Callers
 * still validate the model, PNG payloads, UVs and residency/transition budgets.
 */
export function ordinaryPngRoleSet(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const doc=value as {meshes?:{primitives?:{material?:unknown}[]}[];images?:{mimeType?:unknown;bufferView?:unknown}[];textures?:{source?:unknown;extensions?:unknown}[];materials?:{pbrMetallicRoughness?:{baseColorTexture?:unknown;metallicRoughnessTexture?:unknown};normalTexture?:unknown;occlusionTexture?:unknown}[]};
  if (!Array.isArray(doc.images)||doc.images.length!==3||!Array.isArray(doc.textures)||doc.textures.length!==3||!Array.isArray(doc.materials)||doc.materials.length!==1||
      doc.images.some(i=>!i||i.mimeType!=='image/png'||!Number.isSafeInteger(i.bufferView))||new Set(doc.images.map(i=>i.bufferView)).size!==3||
      doc.textures.some(t=>!t||!Number.isSafeInteger(t.source)||Number(t.source)<0||Number(t.source)>2||t.extensions!==undefined)||new Set(doc.textures.map(t=>t.source)).size!==3) return false;
  if(!Array.isArray(doc.meshes)||!doc.meshes.length||doc.meshes.some(m=>!m||!Array.isArray(m.primitives)||!m.primitives.length||m.primitives.some(p=>!p||p.material!==0)))return false;
  const material=doc.materials[0];if(!material||material.pbrMetallicRoughness?.metallicRoughnessTexture!==undefined)return false;
  try {
    const bindings=[pbrTextureBinding(material.pbrMetallicRoughness?.baseColorTexture,'colour',3),pbrTextureBinding(material.normalTexture,'normal',3),pbrTextureBinding(material.occlusionTexture,'occlusion',3)];
    return new Set(bindings.map(t=>t.index)).size===3;
  } catch { return false; }
}
