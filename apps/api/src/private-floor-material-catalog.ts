// SPDX-License-Identifier: AGPL-3.0-or-later
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { FLOOR_RESOURCE_PACKS } from '@exhibitos/spec/floor-resources';
import { sha256 } from '@exhibitos/storage';
import { ApiError } from './auth.ts';

const floor = FLOOR_RESOURCE_PACKS.find(pack => pack.id === 'quiet-oak-herringbone' && pack.version === 1);

export function privateFloorMaterialCatalog(tenantId: string) {
  if (!floor?.catalogue) throw new ApiError(404, 'MATERIAL_CATALOG_UNAVAILABLE');
  const { catalogue, id, version } = floor;
  const thumbnail = catalogue.thumbnail;
  return {
    version: 1,
    floor: {
      id, version, name: catalogue.displayName.ko,
      defaults: {
        preset: catalogue.preset, texturePack: { id, version },
        repeatMeters: catalogue.defaultRepeatMeters, rotation: 0, normalScale: 1,
      },
      preview: {
        url: `/api/v1/tenants/${tenantId.toLowerCase()}/studio/materials/${id}/${version}/preview`,
        mime: thumbnail.mime, bytes: thumbnail.bytes, sha256: thumbnail.sha256,
        width: thumbnail.width, height: thumbnail.height,
      },
    },
  };
}

export async function readPrivateFloorMaterialPreview(id: string, version: string) {
  if (floor?.id !== id || String(floor.version) !== version || !floor.catalogue) {
    throw new ApiError(404, 'MATERIAL_PREVIEW_UNAVAILABLE');
  }
  const preview = floor.catalogue.thumbnail;
  try {
    let directory = new URL('../../web/dist/', import.meta.url);
    const parts = preview.path.split('/');
    for (const part of parts.slice(0, -1)) {
      const stat = await lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('UNSAFE_DIRECTORY');
      directory = new URL(`${part}/`, directory);
    }
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('UNSAFE_DIRECTORY');
    const file = await open(new URL(parts.at(-1)!, directory), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== preview.bytes) throw Error('SIZE');
      const bytes = Buffer.alloc(preview.bytes + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      const result = bytes.subarray(0, bytesRead);
      if (bytesRead !== preview.bytes || sha256(result) !== preview.sha256) throw Error('INTEGRITY');
      return result;
    } finally {
      await file.close();
    }
  } catch {
    throw new ApiError(409, 'MATERIAL_PREVIEW_INTEGRITY');
  }
}
