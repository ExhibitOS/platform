// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const roomIndirectRecipeScripts = ['prepare-room-indirect.mjs', 'room-indirect-irradiance.mjs'];
export const roomIndirectPortalWorkerPath = 'apps/api/dist/viewer-budget-geometry.mjs';
export const roomIndirectRecipeMarkerPath = 'scripts/native-room-indirect-recipe.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Shared ordered inputs for packaging and the exact Viewer recipe pin. */
export async function readRoomIndirectRecipe(root, includePortalWorker = false) {
  const paths = roomIndirectRecipeScripts.map(name => `scripts/${name}`);
  if (includePortalWorker) paths.push(roomIndirectPortalWorkerPath);
  const digests = await Promise.all(paths.map(async path => sha(await readFile(join(root, path)))));
  return { sha256: sha(JSON.stringify(digests)), digests };
}

/** An optional portal marker is emitted only for a reviewed tuple and is
 * covered by the existing Native runtime manifest. */
export async function readInstalledRoomIndirectRecipe(root) {
  let approved;
  try {
    approved = JSON.parse(await readFile(join(root, roomIndirectRecipeMarkerPath), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return readRoomIndirectRecipe(root);
  }
  const actual = await readRoomIndirectRecipe(root, true);
  if (!isDeepStrictEqual(approved, actual)) throw Error('STATIC_ROOM_INDIRECT_RECIPE');
  return actual;
}
