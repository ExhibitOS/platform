// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {lightDetailsFor} from '@exhibitos/studio-contract';

export type LocalDiffuseReceiverTrial = {
  publicationId: string;
  revisionSha256: string;
  indexSha256: string;
  wallId: string;
  placementId: string;
};

export type LocalDiffuseReceivers = {wallId: string; artworkRevisionId: string; fillLightId: string};

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha256 = /^[a-f0-9]{64}$/;

export function isLocalDiffuseReceiverTrial(value: unknown): value is LocalDiffuseReceiverTrial {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 5) return false;
  const fields = value as Record<string, unknown>;
  const shapes = {publicationId:uuid, revisionSha256:sha256, indexSha256:sha256, wallId:uuid, placementId:uuid};
  return Object.entries(shapes).every(([key, pattern]) => {
    const field = fields[key];
    return Object.hasOwn(fields,key) && typeof field === 'string' && pattern.test(field);
  });
}

declare const __EXHIBITOS_LOCAL_DIFFUSE_RECEIVER_TRIAL__: LocalDiffuseReceiverTrial | undefined;

export function configuredLocalDiffuseReceiverTrial(): LocalDiffuseReceiverTrial | undefined {
  return typeof __EXHIBITOS_LOCAL_DIFFUSE_RECEIVER_TRIAL__ === 'undefined'
    ? undefined : __EXHIBITOS_LOCAL_DIFFUSE_RECEIVER_TRIAL__;
}

export function resolveLocalDiffuseReceivers(
  doc: Exhibition,
  identity: {publicationId: string; revisionSha256: string; indexSha256?: string} | undefined,
  trial: LocalDiffuseReceiverTrial | undefined,
): LocalDiffuseReceivers | undefined {
  if (!trial || !identity || trial.publicationId !== identity.publicationId ||
    trial.revisionSha256 !== identity.revisionSha256 || trial.indexSha256 !== identity.indexSha256) return;
  const wall = doc.surfaces.find(surface => surface.id.toLowerCase() === trial.wallId && surface.type === 'wall');
  const placement = doc.placements.find(item => item.id.toLowerCase() === trial.placementId);
  if (!wall || !placement || placement.roomId.toLowerCase() !== wall.roomId.toLowerCase()) return;
  const artworkRevisionId = placement.artworkRevisionId.toLowerCase();
  const image = doc.artworks.some(artwork => artwork.revisionId.toLowerCase() === artworkRevisionId && artwork.artworkType === 'image');
  // Ordinary tier meshes share an artwork material across placements.
  if (!image || doc.placements.filter(item => item.artworkRevisionId.toLowerCase() === artworkRevisionId).length !== 1) return;
  const details = lightDetailsFor(doc);
  const mark = details.find(detail => detail.purpose === 'room-base' && detail.basePlacement === 'auto' &&
    detail.ceilingFill?.mode === 'default' && doc.lights.some(light => light.id.toLowerCase() === detail.lightId.toLowerCase() &&
      light.roomId.toLowerCase() === wall.roomId.toLowerCase() && light.type === 'area'));
  if (mark) return {wallId: trial.wallId, artworkRevisionId, fillLightId: mark.lightId.toLowerCase()};
}
