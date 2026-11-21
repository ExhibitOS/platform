// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {WORKSPACE_MATERIAL_NAMESPACE, type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {EXPERIENCE_NAMESPACE, experienceFor, floorFor, validateViewerExperience} from '@exhibitos/studio-contract';
import {sha256, type BlobStore} from '@exhibitos/storage';
import type {PoolClient} from 'pg';
import {Audio, audioMedia, validatePcmWav, type MediaAsset} from './audio.ts';
import {ApiError, uuid, type Session} from './auth.ts';
import {allowedRights} from './rights.ts';

export const NATIVE_FLOOR_RECORDING_ATTACHMENT_PROFILE = 'saved-head-floor-recording-attachment-v1';
export interface NativeFloorRecordingAttachmentCommand {
  type: 'attach-floor-recording';
  surfaceId: string;
  materialId: string;
  materialVersion: number;
  audioId: string;
  audioRevision: 1;
  expectedMediaAsset: MediaAsset;
  initializeMissingStoneRow?: true;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
type Footstep = ReturnType<typeof experienceFor>['footsteps'][number];

function assertStoneRecordingSlot(step: Footstep | undefined, audioId: string) {
  if (step && step.material !== 'stone') throw new ApiError(422, 'FLOOR_RECORDING_TARGET_INVALID');
  if (step?.bank || (step?.assetId !== undefined && !same(step.assetId, audioId)))
    throw new ApiError(409, 'FLOOR_RECORDING_ALREADY_BOUND');
}

function assertFloorSoundAllowsAttachment(candidate: Exhibition, surface: Exhibition['surfaces'][number], audioId: string) {
  const sound = floorFor(candidate, {roomId: surface.roomId, surfaceId: surface.id})?.sound;
  if (sound?.mode === 'none') throw new ApiError(409, 'FLOOR_RECORDING_MUTED');
  if (sound?.mode === 'explicit' && (sound.assetIds.length !== 1 || !same(sound.assetIds[0]!, audioId)))
    throw new ApiError(409, 'FLOOR_RECORDING_ALREADY_BOUND');
}

async function approvedFloorRecording(c: PoolClient, s: Session, exhibitionId: string,
  audioId: string, expected: MediaAsset | undefined, blobs: BlobStore | undefined) {
  if (!blobs) throw new ApiError(503, 'STORAGE_UNAVAILABLE');
  const approved = await new Audio(blobs).approved(c, s, exhibitionId, audioId);
  const media = audioMedia(approved);
  if (!isDeepStrictEqual(expected, media)) throw new ApiError(409, 'AUDIO_APPROVAL_CHANGED');
  const bytes = Buffer.from(await blobs.get(approved.object_key));
  if (bytes.length !== media.bytes || sha256(bytes) !== media.sha256) throw new ApiError(409, 'ASSET_INTEGRITY');
  const {durationSeconds} = validatePcmWav(bytes);
  // Match the Viewer admission for a complete, isolated step.
  if (durationSeconds < 0.04 || durationSeconds > 1.5) throw new ApiError(422, 'FLOOR_RECORDING_DURATION');
  if (!allowedRights(media.rights, 'display') || !allowedRights(media.rights, 'export'))
    throw new ApiError(403, 'AUDIO_RIGHTS_DENIED');
  return media;
}

/** Preserve the material binding and initialize only the selected recording row on request. */
export async function nativeFloorRecordingProposal(c: PoolClient, s: Session, exhibitionId: string,
  candidate: Exhibition, command: NativeFloorRecordingAttachmentCommand, blobs: BlobStore | undefined) {
  uuid(command.surfaceId); uuid(command.materialId); uuid(command.audioId);
  const surface = candidate.surfaces.find(row => row.type === 'floor' && same(row.id, command.surfaceId));
  const workspace = candidate.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings | undefined;
  const bindings = workspace?.bindings.filter(row => same(row.surfaceId, command.surfaceId)) ?? [];
  const [binding] = bindings;
  const descriptors = workspace?.materials.filter(row => same(row.id, command.materialId) &&
    row.version === command.materialVersion && row.kind === 'floor') ?? [];
  const experience = experienceFor(candidate);
  const step = experience.footsteps.find(row => same(row.surfaceId, command.surfaceId));
  if (!surface || bindings.length !== 1 || !binding || !same(binding.materialId, command.materialId) ||
      binding.materialVersion !== command.materialVersion || descriptors.length !== 1 ||
      (!step && command.initializeMissingStoneRow !== true) ||
      !validateViewerExperience(candidate).valid) throw new ApiError(422, 'FLOOR_RECORDING_TARGET_INVALID');
  assertFloorSoundAllowsAttachment(candidate, surface, command.audioId);
  assertStoneRecordingSlot(step, command.audioId);
  if (command.audioRevision !== 1) throw new ApiError(409, 'REVISION_CONFLICT');
  const media = await approvedFloorRecording(c, s, exhibitionId, command.audioId, command.expectedMediaAsset, blobs);

  const existing = candidate.mediaAssets.filter(row => same(row.id, media.id));
  if (existing.length > 1 || (existing.length === 1 && !isDeepStrictEqual(existing[0], media)))
    throw new ApiError(409, 'AUDIO_APPROVAL_CHANGED');
  const next = structuredClone(candidate);
  if (existing.length === 0) next.mediaAssets.push(media);
  if (!step) experience.footsteps.push({surfaceId:surface.id, material:'stone', assetId:media.id});
  else if (step.assetId === undefined) step.assetId = media.id;
  next.extensions = {...next.extensions, [EXPERIENCE_NAMESPACE]: experience} as unknown as Exhibition['extensions'];
  if (!validateViewerExperience(next).valid) throw new ApiError(422, 'FLOOR_RECORDING_TARGET_INVALID');
  return {candidate: next, surfaceId: surface.id};
}

/** A later ordinary Save must not rely on a stale proposal's audio approval. */
export async function assertChangedWorkspaceFloorRecordings(c: PoolClient, s: Session, exhibitionId: string,
  before: Exhibition, after: Exhibition, blobs: BlobStore | undefined) {
  const workspace = after.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings | undefined;
  if (!workspace?.bindings.length) return;
  const priorWorkspace = before.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings | undefined;
  const prior = experienceFor(before).footsteps;
  for (const {surfaceId, material, assetId} of experienceFor(after).footsteps) {
    if (material !== 'stone' || assetId === undefined) continue;
    const binding = workspace.bindings.find(row => same(row.surfaceId, surfaceId));
    if (!binding) continue;
    const priorBinding = priorWorkspace?.bindings.find(row => same(row.surfaceId, surfaceId));
    const old = prior.find(row => same(row.surfaceId, surfaceId));
    const expected = after.mediaAssets.find(row => same(row.id, assetId));
    const sameBinding = !!priorBinding && same(priorBinding.materialId, binding.materialId) &&
      priorBinding.materialVersion === binding.materialVersion;
    if (sameBinding &&
        old?.material === material && old.assetId !== undefined && same(old.assetId, assetId) &&
        isDeepStrictEqual(before.mediaAssets.find(row => same(row.id, assetId)), expected)) continue;
    const surface = after.surfaces.find(row => row.type === 'floor' && same(row.id, surfaceId));
    if (!surface) throw new ApiError(422, 'FLOOR_RECORDING_TARGET_INVALID');
    if (!old?.assetId || !same(old.assetId, assetId)) {
      assertStoneRecordingSlot(old, assetId);
      const target = {roomId:surface.roomId,surfaceId:surface.id};
      const savedSurface = before.surfaces.find(row => same(row.id, surface.id));
      if (!sameBinding || !isDeepStrictEqual(savedSurface, surface) ||
          !isDeepStrictEqual(floorFor(before, target)?.sound, floorFor(after, target)?.sound))
        throw new ApiError(422, 'FLOOR_RECORDING_TARGET_INVALID');
    }
    assertFloorSoundAllowsAttachment(after, surface, assetId);
    await approvedFloorRecording(c, s, exhibitionId, assetId, expected, blobs);
  }
}
