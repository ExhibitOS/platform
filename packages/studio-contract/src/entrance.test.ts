// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'vitest';
import { ENTRANCE_NAMESPACE, MAX_COVER_BYTES, entranceFor, validateViewerEntrance } from './entrance';
const id = 'abcdefab-0000-4000-8000-000000000001';
const fixture = () => ({ artworks: [{ artworkType: 'image', primaryAssetId: id, assets: [{ id, role: 'image', mime: 'image/png', bytes: 1024 }] }],
  extensions: { [ENTRANCE_NAMESPACE]: { version: 1, artist: 'Artist', introduction: 'Public introduction', imageAssetId: id.toUpperCase(), imageAlt: 'A blue painting', mobilePosition: 'top' } } });
test('legacy exhibitions have a copy-safe default without an image request', () => {
  expect(validateViewerEntrance({})).toEqual({ valid: true, errors: [] });
  const value = entranceFor({}); value.artist = 'Changed';
  expect(entranceFor({})).toMatchObject({ artist: '', mobilePosition: 'center' });
  expect(entranceFor({})).not.toHaveProperty('imageAssetId');
});
test('public cover accepts a unique primary PNG reference case-insensitively and preserves the source', () => {
  const candidate = fixture(), original = JSON.stringify(candidate);
  expect(validateViewerEntrance(candidate).valid).toBe(true);
  const cover = entranceFor(candidate); cover.introduction = 'Changed';
  expect(JSON.stringify(candidate)).toBe(original);
});
test.each(['privateUrl', 'autoplay', 'token'])('unknown entrance field %s is rejected', field => {
  const candidate = fixture(); Object.assign(candidate.extensions[ENTRANCE_NAMESPACE], { [field]: 'forbidden' });
  expect(validateViewerEntrance(candidate).valid).toBe(false);
});
test.each([null, 1, ['center'], { toString: null, valueOf: null }])('non-string mobile position is rejected without coercion or exceptions: %j', mobilePosition => {
  const candidate = fixture(); Object.assign(candidate.extensions[ENTRANCE_NAMESPACE], { mobilePosition });
  expect(validateViewerEntrance(candidate)).toMatchObject({ valid: false });
});
test('cover rejects missing or ambiguous inventory, GLB, oversized images and empty alt', () => {
  const missing = fixture(); missing.artworks = []; expect(validateViewerEntrance(missing).valid).toBe(false);
  const duplicate = fixture(); duplicate.artworks.push(structuredClone(duplicate.artworks[0]!)); expect(validateViewerEntrance(duplicate).valid).toBe(false);
  const glb = fixture(); glb.artworks[0]!.assets[0]!.mime = 'model/gltf-binary'; expect(validateViewerEntrance(glb).valid).toBe(false);
  const oversized = fixture(); oversized.artworks[0]!.assets[0]!.bytes = MAX_COVER_BYTES + 1; expect(validateViewerEntrance(oversized).valid).toBe(false);
  const noAlt = fixture(); noAlt.extensions[ENTRANCE_NAMESPACE].imageAlt = '  '; expect(validateViewerEntrance(noAlt).valid).toBe(false);
});
test('text poster remains valid without an image and bounded metadata rejects future versions', () => {
  const candidate = fixture(); Reflect.deleteProperty(candidate.extensions[ENTRANCE_NAMESPACE], 'imageAssetId');
  expect(validateViewerEntrance(candidate).valid).toBe(true);
  candidate.extensions[ENTRANCE_NAMESPACE].version = 2;
  expect(validateViewerEntrance(candidate).valid).toBe(false);
});
