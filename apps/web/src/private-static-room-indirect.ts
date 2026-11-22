// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  readStaticRoomIndirect, spatialProgramFor, staticRoomIndirectTexturePath, verifyStaticRoomIndirectEmitters, verifyStaticRoomIndirectTexture,
  type StaticRoomIndirectChart, type StaticRoomIndirectSource,
} from '@exhibitos/studio-contract';
import type {PublicPublication} from './publication-client';
import {parseStaticJson} from './static-json.mjs';

export type LoadedRoomIndirect = {
  roomId: string;
  emitterIds: readonly string[];
  scale: number;
  charts: Array<{chart: StaticRoomIndirectChart; bytes: Uint8Array<ArrayBuffer>}>;
};

const loaded = new WeakMap<PublicPublication, readonly LoadedRoomIndirect[]>();
const sha256 = /^[a-f0-9]{64}$/;

export function verifiedRoomIndirect(publication: PublicPublication | undefined, scene: PublicPublication['exhibition']) {
  if (publication?.exhibition === scene) return loaded.get(publication);
}

export async function attachPrivateStaticRoomIndirect(
  publication: PublicPublication, source: StaticRoomIndirectSource,
  read: (path: string, limit: number, signal: AbortSignal) => Promise<Uint8Array>,
  hash: (bytes: Uint8Array) => Promise<string>,
) {
  const recipe: unknown = import.meta.env.VITE_EXHIBITOS_PRIVATE_ROOM_INDIRECT_RECIPE_SHA256;
  if (typeof recipe !== 'string' || !sha256.test(recipe) || spatialProgramFor(publication.exhibition).rules.length) return;
  try {
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="exhibitos-static-room-indirect"]');
    const digest = metas[0]?.content;
    if (metas.length !== 1 || !digest || !sha256.test(digest)) return;
    const deadline = AbortSignal.timeout(6000);
    const descriptorBytes = await read(`data/${digest}.json`, 524288, deadline);
    if (await hash(descriptorBytes) !== digest) return;
    const descriptor = readStaticRoomIndirect(parseStaticJson(descriptorBytes), source, publication.exhibition, recipe);
    if (!descriptor) return;

    const rooms: LoadedRoomIndirect[] = [];
    for (const room of descriptor.rooms) {
      if (deadline.aborted) break;
      if (!await verifyStaticRoomIndirectEmitters(room, publication.exhibition)) continue;
      const result = await Promise.allSettled(room.charts.map(async chart => {
        const raw = await read(staticRoomIndirectTexturePath(chart), chart.texture.bytes, deadline);
        const bytes = await verifyStaticRoomIndirectTexture(chart, raw);
        if (!bytes) throw Error('STATIC_ROOM_INDIRECT_HASH');
        return {chart, bytes};
      }));
      if (deadline.aborted) break;
      if (result.every(entry => entry.status === 'fulfilled')) {
        rooms.push({roomId: room.roomId, emitterIds: room.emitterIds, scale: room.scale, charts: result.map(entry => entry.value)});
      }
    }
    if (rooms.length) loaded.set(publication, rooms);
  } catch {
    // An optional companion's transfer or validation leaves the original Viewer available.
  }
}
