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
