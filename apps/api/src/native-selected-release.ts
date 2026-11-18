// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import type {Exhibition} from '@exhibitos/spec';
import {
  applyArchitecturalFinishCommand, ENTRANCE_NAMESPACE, EXPERIENCE_NAMESPACE, experienceFor,
  validateViewerEntrance, validateViewerExperience, wallFinishesFor,
} from '@exhibitos/studio-contract';
import {ApiError, type Session} from './auth.ts';
import {Audio, audioMedia} from './audio.ts';
import {allowedRights} from './rights.ts';
import {etag, type Draft} from './studio.ts';
import type {NativeOriginalPublication} from './native-original-publication.ts';

export const SELECTED_NATIVE_RELEASE = 'r125-approved-r201-v1';
export type NativeReleaseSelection = typeof SELECTED_NATIVE_RELEASE;
const baselineRevision = 125;
const currentRevision = 201;
const baselineHead = '"studio-r125-d718f9a7bfe0add6826282eedd9efd40d29ce3fc1a1e18241c18012435e39d29"';
const currentHead = '"studio-r201-2fac6adaf0ca67ae1b36d7924f2f916a4eed7e314a53e5b1262f204a54d002bc"';
const baseboardWall = 'c6c63834-b58f-4f7e-a2cf-a81c8d937cea';
const entranceImage = 'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7';
const narrationCount = 19;
const unavailable = (): never => { throw new ApiError(409, 'NATIVE_DETAIL_UNAVAILABLE'); };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

type SavedHead = {revision: number; metadata: Draft; studio_owner_user_id: string};
export type SelectedNativeRelease = ReturnType<typeof composeSelectedScene>;

/** The stored ETags cover the full private drafts, including their exhibition
 * identity. Only the exact Studio owner may pick this release on that head. */
export async function loadSelectedNativeRelease(
  c: PoolClient, s: Session, exhibitionId: string, row: SavedHead,
  match: string, image: NativeOriginalPublication['originalImage'],
): Promise<SelectedNativeRelease> {
  if (row.studio_owner_user_id !== s.userId) throw new ApiError(403, 'FORBIDDEN');
  if (row.revision !== currentRevision || match !== currentHead || etag(row.revision, row.metadata) !== match)
    throw new ApiError(412, 'REMOTE_CONFLICT');
  if (!image || fingerprint([image.artworkId, image.artworkRevision, image.importJobId]) !==
      'd0825de02f2b0367a78eb3bda31670428bf074cbe92ae01ad6569f11df1b5496')
    return unavailable();

  const saved = await c.query<{snapshot: Draft}>(
    'SELECT snapshot FROM exhibition_revisions WHERE tenant_id=$1 AND exhibition_id=$2 AND revision=$3',
    [s.tenantId, exhibitionId, baselineRevision],
  );
  const baseline = saved.rows[0]?.snapshot;
  if (!baseline || baseline.exhibitionId !== exhibitionId || row.metadata.exhibitionId !== exhibitionId ||
      etag(baselineRevision, baseline) !== baselineHead)
    return unavailable();

  return composeSelectedScene(baseline.candidate, row.metadata.candidate);
}

/** Compose the approved fields using authored IDs in the same exhibition.
 * All other fields are inherited directly from the saved presentation. */
export function composeSelectedScene(baseline: Exhibition, current: Exhibition) {
  const entrance = current.extensions?.[ENTRANCE_NAMESPACE];
  const wheat = baseline.artworks.flatMap(artwork => artwork.assets)
    .find(asset => asset.id === entrance?.imageAssetId && asset.mime === 'image/png');
  if (!entrance || wheat?.sha256 !== entranceImage || !validateViewerEntrance(current).valid)
    return unavailable();

  const oldWall = wallFinishesFor(baseline).find(wall => wall.surfaceId === baseboardWall);
  const newWall = wallFinishesFor(current).find(wall => wall.surfaceId === baseboardWall);
  if (!oldWall || oldWall.preset !== 'plain' || oldWall.plainBaseboard === true ||
      oldWall.baseboardHeight !== 0.04 || !isDeepStrictEqual(newWall, {...oldWall, plainBaseboard: true}))
    return unavailable();

  const experience = experienceFor(baseline);
  const voices = experienceFor(current).voices.filter(voice => voice.locale === 'ko');
  const placements = new Map(baseline.placements.map(placement => [placement.id, placement]));
  const savedPlacements = new Map(current.placements.map(placement => [placement.id, placement]));
  const narrationIds = new Set(voices.map(voice => voice.assetId));
  const narration = current.mediaAssets.filter(asset => narrationIds.has(asset.id));
  if (placements.size !== narrationCount || voices.length !== narrationCount ||
      new Set(voices.map(voice => voice.placementId)).size !== narrationCount ||
      narrationIds.size !== narrationCount || narration.length !== narrationCount ||
      narration.some(asset => asset.mime !== 'audio/wav') ||
      !voices.every(voice => placements.has(voice.placementId) &&
        isDeepStrictEqual(placements.get(voice.placementId), savedPlacements.get(voice.placementId))) ||
      experience.voices.some(voice => voice.locale.toLowerCase() === 'ko') ||
      baseline.mediaAssets.some(asset => narrationIds.has(asset.id)))
    return unavailable();

  const candidate = applyArchitecturalFinishCommand(baseline, {
    type: 'set-wall-finish', wall: {...oldWall, plainBaseboard: true},
  });
  candidate.title = current.title;
  candidate.mediaAssets.push(...structuredClone(narration));
  experience.voices.push(...voices);
  candidate.extensions = {
    ...candidate.extensions, [ENTRANCE_NAMESPACE]: structuredClone(entrance),
    [EXPERIENCE_NAMESPACE]: experience as unknown as NonNullable<Exhibition['extensions']>[string],
  };
  if (!validateViewerEntrance(candidate).valid || !validateViewerExperience(candidate).valid)
    return unavailable();
  return {candidate, narration};
}

/** Read approvals in the current transaction. Publication preparation also
 * verifies the PCM bytes and the live audio approval's exact media descriptor. */
export async function selectedNarrationRights(c: PoolClient, s: Session, exhibitionId: string, selection: SelectedNativeRelease) {
  const audio = new Audio();
  const grants: unknown[] = [];
  for (const asset of selection.narration) {
    const row = await audio.approved(c, s, exhibitionId, asset.id);
    if (!isDeepStrictEqual(audioMedia(row), asset)) throw new ApiError(409, 'AUDIO_APPROVAL_CHANGED');
    grants.push(row.rights);
  }
  const assertTime = () => {
    const now = Date.now();
    if (grants.some(rights => !allowedRights(rights, 'display', now) || !allowedRights(rights, 'export', now)))
      throw new ApiError(403, 'AUDIO_RIGHTS_DENIED');
  };
  assertTime();
  return assertTime;
}

/** The digest pins the three custody kinds, CMS lineages, import jobs and
 * original descriptors. It is checked only after the live producer derived
 * each member. A matching source hash cannot supply an approval. */
export function assertSelectedOriginals(prepared: Awaited<ReturnType<NativeOriginalPublication['prepare']>>) {
  const records = [
    ...prepared.items.map(item => ['owner-local-jpeg', item.artworkId, item.artworkRevision, item.importJobId,
      item.candidate.mime, item.candidate.bytes, item.candidate.sha256]),
    ...prepared.requiredModels.map(({input, candidate}) => [input.kind, input.artworkId, input.artworkRevision, input.importJobId,
      candidate.mime, candidate.bytes, candidate.sha256]),
  ].map(record => JSON.stringify(record)).sort();
  if (prepared.models.length !== 0 || fingerprint(records) !==
      '6d88f1b79b197f6d7d21804a51eced05f0d9b69e81637baf0b78414a2fda8a9a')
    unavailable();
}
