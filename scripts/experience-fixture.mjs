// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
/** Original deterministic PCM tone; synthesized bytes, no borrowed recording. */
export function syntheticWav({ rate = 16000, channels = 1, seconds = 2, frequency = 330 } = {}) {
  const frames = Math.floor(rate * seconds), bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(frames * channels * 2, 40);
  for (let f = 0; f < frames; f++) for (let c = 0; c < channels; c++)
    bytes.writeInt16LE(Math.round(Math.sin(f / rate * 2 * Math.PI * frequency) * 8000 * Math.min(1, f / (rate * .01), (frames - f) / (rate * .01))), 44 + (f * channels + c) * 2);
  return bytes;
}
export function addExperience(document, mediaAsset) {
  const doc = document, placementId = doc.placements[0].id, annotationId = randomUUID();
  // Experience-only acoustic contrast: retain the shared navigation fixture's
  // floor plan and reciprocal openings, but give room2 a genuinely taller volume.
  const taller = doc.rooms[1], delta = 6 - taller.dimensions.height;
  // The inherited navigation fixture reuses room dimension objects. Replace
  // room2's value instead of mutating that alias and enlarging room1 as well.
  taller.dimensions = { ...taller.dimensions, height: 6 };
  for (const surface of doc.surfaces.filter(s => s.roomId === taller.id)) {
    if (surface.type === "ceiling") surface.transform.position[1] += delta;
    if (surface.type === "wall") {
      surface.dimensions.height += delta;
      surface.transform.position[1] += delta / 2;
      // Offsets are measured from wall center. Retain exact world heights for
      // both door and window, including the reciprocal4m/6m partition pair.
      for (const opening of doc.openings.filter(o => o.surfaceId === surface.id)) opening.offset[1] -= delta / 2;
    }
  }
  doc.mediaAssets = [mediaAsset];
  doc.annotations = [{ id: annotationId, placementId, text: "Original synthetic material annotation" }];
  doc.audioZones = [{ id: randomUUID(), roomId: doc.rooms[0].id, assetId: mediaAsset.id,
    position: [0, 1.65, 1], radius: 5, volume: .7, autoplay: false, transcript: "Original synthetic room transcript" }];
  doc.extensions["org.exhibitos.viewer/experience"] = { version: 1,
    footsteps: doc.surfaces.filter(s => s.type === "floor").map((s, i) => ({ surfaceId: s.id, material: i ? "carpet" : "wood" })),
    voices: [{ placementId, assetId: mediaAsset.id, transcript: "Original synthetic artist voice transcript", locale: "ko" }],
    annotations: [{ annotationId, position: [.1, .1, .1] }],
    rooms: doc.rooms.map((r, i) => ({ roomId: r.id, reverb: i ? .8 : .1 })),
    translations: [{ placementId, locale: "en", title: "Translated synthetic title", description: "Translated synthetic description" }] };
  doc.extensions["org.exhibitos.studio/presentation"].credits = "Original synthetic experience credits";
  return doc;
}
