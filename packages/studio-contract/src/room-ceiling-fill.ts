// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';

export interface RoomCeilingFill {
  version: 1;
  brightness: number;
}

type RoomDimensions = Exhibition['rooms'][number]['dimensions'];
type CeilingFillEmitter = Pick<Exhibition['lights'][number], 'dimensions' | 'intensity' | 'transform'>;

const panelInsetRatio = 0.8;
const ceilingGapMetres = 0.02;
const samplesPerAxis = 12;

function midpoint(index: number, length: number): number {
  return ((index + 0.5) / samplesPerAxis - 0.5) * length;
}

/** Ideal mean direct floor lux per lumen of the downward Lambertian panel. */
function meanFloorLuxPerLumen(floor: RoomDimensions, panelWidth: number, panelDepth: number, height: number): number {
  const heightSquared = height * height;
  let sum = 0;
  for (let floorX = 0; floorX < samplesPerAxis; floorX++) {
    for (let floorZ = 0; floorZ < samplesPerAxis; floorZ++) {
      for (let panelX = 0; panelX < samplesPerAxis; panelX++) {
        const dx = midpoint(floorX, floor.width) - midpoint(panelX, panelWidth);
        for (let panelZ = 0; panelZ < samplesPerAxis; panelZ++) {
          const dz = midpoint(floorZ, floor.depth) - midpoint(panelZ, panelDepth);
          const distanceSquared = heightSquared + dx * dx + dz * dz;
          sum += heightSquared / (Math.PI * distanceSquared * distanceSquared);
        }
      }
    }
  }
  return sum / samplesPerAxis ** 4;
}

/** Version 1 trial recipe for an already verified flat, rectangular room. */
export function deriveRoomCeilingFill(room: RoomDimensions, brightness: number): CeilingFillEmitter {
  if (![room.width, room.depth, room.height].every(dimension => Number.isFinite(dimension) && dimension > 0 && dimension <= 10_000) || room.height <= ceilingGapMetres) {
    throw new Error('ROOM_CEILING_FILL_GEOMETRY');
  }
  if (!Number.isFinite(brightness) || brightness < 0 || brightness > 1) {
    throw new Error('ROOM_CEILING_FILL_BRIGHTNESS');
  }

  const width = room.width * panelInsetRatio;
  const depth = room.depth * panelInsetRatio;
  const height = room.height - ceilingGapMetres;
  // The trial maps full brightness to one ideal mean floor lux.
  const intensity = brightness === 0 ? 0 : brightness / meanFloorLuxPerLumen(room, width, depth, height);
  if (!Number.isFinite(intensity) || (brightness > 0 && intensity <= 0)) {
    throw new Error('ROOM_CEILING_FILL_GEOMETRY');
  }
  return {
    dimensions: { width, height: depth },
    intensity,
    transform: {
      position: [0, height, 0],
      rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      scale: [1, 1, 1],
    },
  };
}
