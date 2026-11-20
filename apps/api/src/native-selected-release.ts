// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import type {Exhibition} from '@exhibitos/spec';
import {FOOTSTEP_RESOURCE_NAMESPACE, footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {WORKSPACE_MATERIAL_NAMESPACE, type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {
  applyArchitecturalFinishCommand, applyLightObjectCommand, ENTRANCE_NAMESPACE, EXPERIENCE_NAMESPACE, experienceFor, floorFor, FLOOR_NAMESPACE,
  freezeCanonical, FURNISHING_NAMESPACE, furnishingsFor, lightAttachmentsFor, lightDetailsFor, LIGHT_ATTACHMENT_NAMESPACE, LIGHT_DETAILS_NAMESPACE, plaquesFor,
  resolveTrackSpotAiming, ROOM_CEILING_FILL_INITIAL_BRIGHTNESS, setRoomCeilingFillBrightness, validateFurnishings, validateLightAttachments, validateStudioLightDetails,
  validateViewerEntrance, validateViewerExperience, validateWorkspaceFurnishings, wallFinishesFor,
  PAINTING_BENCH_SELECTED_SCOPE, WHEAT_IMAGE_FIT_SELECTED_SCOPE, WHEAT_SELECTED_SCOPE, WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishingDescriptor, type WorkspaceFurnishingPlacement, type WorkspaceFurnishings,
} from '@exhibitos/studio-contract';
import {ApiError, type Session} from './auth.ts';
import {Audio, audioMedia} from './audio.ts';
import {installedFurnishingDescriptorFor} from './installed-workspace-furnishing.ts';
import {allowedRights} from './rights.ts';
import {etag, type Draft} from './studio.ts';
import type {NativeOriginalPublication} from './native-original-publication.ts';
import {
  ACCEPTED_WHEAT_PREDECESSOR, OCCUPIED_PAINTING_BENCH_ETAG, OCCUPIED_PAINTING_BENCH_REVISION,
  OCCUPIED_CANNON_SCOPE, OCCUPIED_PUBLIC_FINISH_SCOPE, OCCUPIED_POST_WHEAT_ETAG, OCCUPIED_POST_WHEAT_REVISION,
  OCCUPIED_SELECTED_FINISH_ETAG,
  OCCUPIED_SELECTED_FINISH_REVISION, OCCUPIED_SELECTED_OUTPUT_REVISION,
  requiresOccupiedSelectedHead, WHEAT_IMAGE_FIT_SUCCESSOR_REVISION, type NativeDetailContext,
} from './native-detail-context.ts';
import {projectSelectedVisualFinishes} from './native-selected-finishes.ts';
import {ACCEPTED_PUBLIC_WHEAT_MANIFEST,assertAcceptedSelectedPredecessor,projectSelectedWheatFrame,projectSelectedWheatImageFit} from './native-selected-wheat.ts';
import {projectSelectedPaintingBench} from './native-selected-painting-bench.ts';

// Keep the persisted selection mode stable across exact-head corrections.
export const SELECTED_NATIVE_RELEASE = 'r125-approved-r201-v1';
export type NativeReleaseSelection = typeof SELECTED_NATIVE_RELEASE;
const baselineRevision = 125;
const currentRevision = 209;
const baselineHeadFingerprint = '6a72a23fee8814e9b17803d07c915a5b9119a7c8089dfd96f545df30ad8f2739';
const currentHeadFingerprint = '9f65016cf75b3a6a38b5b15f85031fe62003d1e28b90d2b31101dbf42852e21d';
const captionStandsRevision = 210;
const cannonId = 'f8802a33-ccfc-4633-9369-37142e290d8e';
const cannonCommitment = '3d5c8a4f2e97984fa967a5bf47ba84b77a6d713ba36c017ff51fbac6371fdab7';
const acceptedSevenFinishesScene = '88fe9a946639467be77772c0b444b1f57e913bb77411c16c86de6fc1fe91cf4c';
const approvedPublicCaptionIdentity = 'v1:08b75309a86fbb928e887aa63188d2b88ed31af1bdc54308256fc6e4d41c95d8';
const approvedPublicBody = '342e80dcf6ec9126a18239c4b1c9d95050b30e2ed980e9c4d9b65815428aa818';
const occupiedLightingETag = '"studio-r215-4c96569af0cca07ee52acaa281e6b9c486962efb10f4d2955afa799e859fbeed"';
const captionStandsHeadFingerprint = '2a7c53715e9658cb2dd3266f1a12401432d49d27c283ba349e7415b97d5b8671';
const acceptedGreekScene = '19df6f29ed2887f73898209e6848f9a25970e67fbf8983798a420eac78e3172f';
const captionStandsCommitment = '12b89f7f3562f84e864581078fbf81342982e943fa33ee124bdc8a6d1b42435d';
const captionStandId = 'a358b4d2-8f6c-5c0f-8421-a06e90624a94';
const captionStandTargets = [
  { stand: 'e81bf2a0-7cec-53d3-9bec-884c202faa33', plaque: '35ec53a9-99a5-43c5-9e78-f1e018faf375' },
  { stand: '54b26da4-2146-5f43-8a63-4cf5dcc063fd', plaque: '05c334fe-fd20-4f09-893b-55d436980a3c' },
] as const;
const currentApprovedBrassFrames: ApprovedBrassFrames = [
  '8a86db6ab23383867d158d3d847b6034ad2396d75ca75a4916f20cfaac2b3c98',
  '236ea038a5f012f727c35b0d7681ff7f6ceaf2adaa80e319e443069713baaa07',
];
const approvedFloorSounds: ApprovedFootsteps = {
  paintingTarget: 'ad02aaf4d53c8cedc542eb08baa3117fae93d12dce4939dc0a96cb3ca8efcf3f',
  entranceTarget: 'c39b0140ab9295cd170f455749bc3d56eff6a74ff97c95bdbfa97cd14fb08eee',
  commitment: '675552fdf8b1f8dd1714d7e319ac8732ca832fac4097dc59955808f6eb7e8e92',
};
const artworkSpotProjection = 'aristotle-fishing-spots-v1';
const sculpturePointRetirement = 'daff7e16e4b07726742061a60e49af649857a9b5c0e216f9720275ecfa9b7bdf';
const greekSpotProjection = 'greek-spot-on-point-retirement-v1';
const greekSpotId = '4c7ab071-02d9-4132-b65e-9c3ff9bde1a2';
const greekPlacementId = '04848de5-f991-4aea-a82c-21f45ae40bcd';
const greekCeilingId = '5bc91eae-3dca-401a-ba78-a70914675748';
const greekModel = '822dc25f92fa15da7a42e5bf15147fa63e8180eb4e04bf14d9998412ee1a1e15';
const greekSpotCommitment = '4c291c41f37814eeeea4232800d8b0909fb312c3fbfd57c2d813f08e9baaf832';
const greekPriorScene = '3b3803caa9706363af145f76eebf46128ca50add50f1a1482bf882feb68231f8';
// Commitments are over the resolved optics and retained mount and fixture pose,
// without the random identifiers created by the publication snapshot.
const artworkSpots = [
  {placement: '0832027c-a2d2-45e9-8025-12b84febc9c9', light: '78edc3a0-2f16-43c1-bb2d-fd5e53bafa37',
    rail: '6d8c63f8-1001-4d59-8b5b-0cb80b992821',
    railModel: 'aca126489bf21adcc637e9a3c3bb805bb57f93111c3333a8fdefab9d371d1c42',
    before: null, after: 'b3f99fa734513b1c06933b9a725487e5b69cfd2ddf84af1fe423849db0744e2a'},
  {placement: 'dd690963-dfd9-4d27-9dac-164403815493', light: '528f007e-5274-4871-8ab0-470b96cb74f8',
    rail: '15b3814f-b643-4e1c-a503-286eaeda8223',
    railModel: 'dcf99d8d5568bd5eba2614028ca3bf545a86251c435af1614b851d873c104ae7',
    before: 'a22fbb6237592fdb164a9c3fcc00369cf1d8f7b42e754ae1252e87633331bf4f',
    after: 'aed444fbbb0476afbcfdaac9096232dc6c66fbf26c0962f9f08ad78eb92276e4'},
] as const;
const articulatedHead = 'e6801dd02c4f11a1c48b5cf64d97b775924bab10ea7dd533e2904db3a4d6d3a3';
const baseboardWallFingerprint = 'b89444c0246284b1b41bf073db78bf658f2e50d397a7f6be0c165c26ae196aee';
const entranceImage = 'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7';
const narrationCount = 19;
const unavailable = (): never => { throw new ApiError(409, 'NATIVE_DETAIL_UNAVAILABLE'); };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const releaseFingerprint = (value: string) => fingerprint([SELECTED_NATIVE_RELEASE, value]);
const selectedBaseboardWall = (surfaceId: string) => releaseFingerprint(surfaceId) === baseboardWallFingerprint;

type SavedHead = {revision: number; metadata: Draft; studio_owner_user_id: string};
type ApprovedBrassFrames = readonly [string, string];
type ApprovedFootsteps = {paintingTarget: string; entranceTarget: string; commitment: string};
export type SelectedProjectionIdentity = `v1:${string}`;
export type SelectedNativeRelease = ReturnType<typeof composeSelectedScene> & {projectionIdentity: SelectedProjectionIdentity; wheatScope?: typeof WHEAT_SELECTED_SCOPE | typeof PAINTING_BENCH_SELECTED_SCOPE | typeof WHEAT_IMAGE_FIT_SELECTED_SCOPE};
const footstepTarget = (role: 'painting' | 'entrance', id: string) =>
  fingerprint([SELECTED_NATIVE_RELEASE, 'footstep-target-v1', role, id]);

/** The stored ETags cover the full private drafts, including their exhibition
 * identity. Only the exact Studio owner may pick this release on that head. */
export async function loadSelectedNativeRelease(
  c: PoolClient, s: Session, exhibitionId: string, row: SavedHead,
  match: string, image: NativeOriginalPublication['originalImage'], selectedHead?: NativeDetailContext['selectedHead'],
): Promise<SelectedNativeRelease> {
  if (row.studio_owner_user_id !== s.userId) throw new ApiError(403, 'FORBIDDEN');
  const postWheat = row.revision === OCCUPIED_POST_WHEAT_REVISION;
  const paintingBench = row.revision === OCCUPIED_PAINTING_BENCH_REVISION;
  const wheatImageFit = row.revision === WHEAT_IMAGE_FIT_SUCCESSOR_REVISION;
  const historicalFinish = postWheat || paintingBench || wheatImageFit;
  const visualFinishes = historicalFinish || row.revision === OCCUPIED_SELECTED_FINISH_REVISION;
  const defaultLighting = requiresOccupiedSelectedHead(row.revision);
  if (defaultLighting && !selectedHead) return unavailable();
  const finishMatch = paintingBench ? OCCUPIED_PAINTING_BENCH_ETAG : postWheat ? OCCUPIED_POST_WHEAT_ETAG : OCCUPIED_SELECTED_FINISH_ETAG;
  if ((visualFinishes && !wheatImageFit && match !== finishMatch) ||
      (selectedHead && (row.revision !== selectedHead.revision || match !== selectedHead.etag)))
    throw new ApiError(412, 'REMOTE_CONFLICT');
  if (postWheat && !selectedHead?.scope) return unavailable();
  if (paintingBench && selectedHead?.scope !== PAINTING_BENCH_SELECTED_SCOPE) return unavailable();
  if (wheatImageFit && selectedHead?.scope !== WHEAT_IMAGE_FIT_SELECTED_SCOPE) return unavailable();
  const captionStands = row.revision === captionStandsRevision || defaultLighting;
  if ((!captionStands && row.revision !== currentRevision) || etag(row.revision, row.metadata) !== match ||
      (!defaultLighting && releaseFingerprint(match) !== (captionStands ? captionStandsHeadFingerprint : currentHeadFingerprint)))
    throw new ApiError(412, 'REMOTE_CONFLICT');
  if (!image || fingerprint([image.artworkId, image.artworkRevision, image.importJobId]) !==
      'd0825de02f2b0367a78eb3bda31670428bf074cbe92ae01ad6569f11df1b5496')
    return unavailable();

  const savedRevision = async (revision: number) => (await c.query<{snapshot: Draft}>(
    'SELECT snapshot FROM exhibition_revisions WHERE tenant_id=$1 AND exhibition_id=$2 AND revision=$3',
    [s.tenantId, exhibitionId, revision],
  )).rows[0]?.snapshot;
  const baseline = await savedRevision(baselineRevision);
  if (!baseline || baseline.exhibitionId !== exhibitionId || row.metadata.exhibitionId !== exhibitionId ||
      releaseFingerprint(etag(baselineRevision, baseline)) !== baselineHeadFingerprint)
    return unavailable();

  const source = captionStands ? await savedRevision(currentRevision) : row.metadata;
  if (!source || source.exhibitionId !== exhibitionId) return unavailable();
  const sourceETag = captionStands ? etag(currentRevision, source) : match;
  if (captionStands && releaseFingerprint(sourceETag) !== currentHeadFingerprint) return unavailable();
  const selected = composeSelectedScene(baseline.candidate, source.candidate, currentApprovedBrassFrames, approvedFloorSounds);
  const artworkCandidate = projectSelectedArtworkSpots(selected.candidate, source.candidate);
  const prior = artworkSpotProjectionIdentity(sourceETag, artworkCandidate);
  const candidate = projectGreekOnAcceptedArtworkSpots(artworkCandidate, source.candidate);
  const projectionIdentity: SelectedProjectionIdentity = `v1:${createHash('sha256').update(freezeCanonical([
    SELECTED_NATIVE_RELEASE, greekSpotProjection, prior, sculpturePointRetirement, greekSpotCommitment, candidate,
  ])).digest('hex')}`;
  if (!captionStands) return {...selected, candidate, projectionIdentity};

  if (createHash('sha256').update(freezeCanonical(candidate)).digest('hex') !== acceptedGreekScene)
    return unavailable();
  const captionHead = defaultLighting ? await savedRevision(captionStandsRevision) : row.metadata;
  if (!captionHead || captionHead.exhibitionId !== exhibitionId) return unavailable();
  const captionETag = etag(captionStandsRevision, captionHead);
  if (releaseFingerprint(captionETag) !== captionStandsHeadFingerprint) return unavailable();
  const withStands = projectSelectedCaptionStands(candidate, source.candidate, captionHead.candidate);
  const captionIdentity: SelectedProjectionIdentity = `v1:${createHash('sha256').update(freezeCanonical([
    SELECTED_NATIVE_RELEASE, projectionIdentity, captionETag, captionStandsCommitment, withStands,
  ])).digest('hex')}`;
  if (!defaultLighting) return {...selected, candidate: withStands, projectionIdentity: captionIdentity};

  const lightingHead = visualFinishes ? await savedRevision(OCCUPIED_SELECTED_OUTPUT_REVISION) : row.metadata;
  const lightingETag = visualFinishes ? occupiedLightingETag : match;
  if (!lightingHead || lightingHead.exhibitionId !== exhibitionId ||
      (visualFinishes && etag(OCCUPIED_SELECTED_OUTPUT_REVISION, lightingHead) !== lightingETag))
    return unavailable();
  // The current owner and ETag still govern export. The authenticated full r217
  // head adds the unrelated Wheat attachment; preserve the exact r216 inputs to
  // both scoped projections instead of carrying its subsequent authoring into either scene.
  const finishHead = historicalFinish ? await savedRevision(OCCUPIED_SELECTED_FINISH_REVISION) : row.metadata;
  if (!finishHead || (historicalFinish && (finishHead.exhibitionId !== exhibitionId ||
      etag(OCCUPIED_SELECTED_FINISH_REVISION, finishHead) !== OCCUPIED_SELECTED_FINISH_ETAG)))
    return unavailable();

  if (selectedHead?.scope === OCCUPIED_PUBLIC_FINISH_SCOPE || selectedHead?.scope === WHEAT_SELECTED_SCOPE ||
      selectedHead?.scope === PAINTING_BENCH_SELECTED_SCOPE || selectedHead?.scope === WHEAT_IMAGE_FIT_SELECTED_SCOPE) {
    // Replay the retained public projection. The full r215 draft is used only
    // to prove that the exact authenticated r216 authoring delta is the five saved textures.
    if (captionIdentity !== approvedPublicCaptionIdentity) return unavailable();
    const publicFinishes = projectSelectedVisualFinishes(withStands, lightingHead, finishHead);
    const publicPredecessor = fingerprintCanonical([captionIdentity, approvedPublicBody]);
    if (selectedHead.scope === OCCUPIED_PUBLIC_FINISH_SCOPE)
      return bindScopedSelection(selected, publicFinishes, publicPredecessor, match, selectedHead);
    if (selectedHead.scope === PAINTING_BENCH_SELECTED_SCOPE || selectedHead.scope === WHEAT_IMAGE_FIT_SELECTED_SCOPE) {
      const repair = selectedHead.scope === WHEAT_IMAGE_FIT_SELECTED_SCOPE;
      if ((repair ? !wheatImageFit : !paintingBench) || selectedHead.predecessorPublicationId !== ACCEPTED_WHEAT_PREDECESSOR.publicationId ||
          selectedHead.predecessorRevisionSha256 !== ACCEPTED_WHEAT_PREDECESSOR.revisionSha256) return unavailable();
      const wheatHead = await savedRevision(OCCUPIED_POST_WHEAT_REVISION);
      if (!wheatHead || wheatHead.exhibitionId !== exhibitionId ||
          etag(OCCUPIED_POST_WHEAT_REVISION, wheatHead) !== OCCUPIED_POST_WHEAT_ETAG) return unavailable();
      await assertAcceptedSelectedPredecessor(c, s, exhibitionId, {
        ...selectedHead, revision: OCCUPIED_POST_WHEAT_REVISION, etag: OCCUPIED_POST_WHEAT_ETAG,
      }, SELECTED_NATIVE_RELEASE, ACCEPTED_WHEAT_PREDECESSOR.projectionIdentity, WHEAT_SELECTED_SCOPE);
      const withWheat = await projectSelectedWheatFrame(publicFinishes, finishHead.candidate, wheatHead.candidate);
      const predecessor = fingerprintCanonical([ACCEPTED_WHEAT_PREDECESSOR.projectionIdentity,
        selectedHead.predecessorPublicationId, selectedHead.predecessorRevisionSha256,
        ...(repair ? [ACCEPTED_PUBLIC_WHEAT_MANIFEST] : [])]);
      if (repair) {
        const benchHead = await savedRevision(OCCUPIED_PAINTING_BENCH_REVISION);
        if (!benchHead || benchHead.exhibitionId !== exhibitionId ||
            etag(OCCUPIED_PAINTING_BENCH_REVISION, benchHead) !== OCCUPIED_PAINTING_BENCH_ETAG ||
            row.metadata.editVersion !== benchHead.editVersion + 1 ||
            !isDeepStrictEqual({...row.metadata, candidate: benchHead.candidate,
              editVersion: benchHead.editVersion, updatedAt: benchHead.updatedAt}, benchHead)) return unavailable();
        const candidate = projectSelectedWheatImageFit(withWheat, benchHead.candidate, row.metadata.candidate);
        return {...bindScopedSelection(selected, candidate, predecessor, match, selectedHead), wheatScope: WHEAT_IMAGE_FIT_SELECTED_SCOPE};
      }
      const candidate = await projectSelectedPaintingBench(withWheat, wheatHead.candidate, row.metadata.candidate);
      return {...bindScopedSelection(selected, candidate, predecessor, match, selectedHead), wheatScope: PAINTING_BENCH_SELECTED_SCOPE};
    }
    if (selectedHead.scope !== WHEAT_SELECTED_SCOPE || !postWheat) return unavailable();
    const approvedProjection = scopedProjectionIdentity(publicFinishes, publicPredecessor, match, OCCUPIED_PUBLIC_FINISH_SCOPE);
    await assertAcceptedSelectedPredecessor(c, s, exhibitionId, selectedHead, SELECTED_NATIVE_RELEASE, approvedProjection);
    const withWheat = await projectSelectedWheatFrame(publicFinishes, finishHead.candidate, row.metadata.candidate);
    const predecessor = fingerprintCanonical([approvedProjection, selectedHead.predecessorPublicationId, selectedHead.predecessorRevisionSha256]);
    return {...bindScopedSelection(selected, withWheat, predecessor, match, selectedHead), wheatScope: WHEAT_SELECTED_SCOPE};
  }

  const withLighting = projectSelectedRoomLighting(withStands, captionHead, lightingHead);
  const lightingIdentity: SelectedProjectionIdentity = `v1:${createHash('sha256').update(freezeCanonical([
    SELECTED_NATIVE_RELEASE, captionIdentity, 'room-ceiling-fill-default-v1', lightingETag, withLighting,
  ])).digest('hex')}`;
  if (!visualFinishes) return {...selected, candidate: withLighting, projectionIdentity: lightingIdentity};

  const withFinishes = projectSelectedVisualFinishes(withLighting, lightingHead, finishHead);
  const finishIdentity: SelectedProjectionIdentity = `v1:${fingerprintCanonical([
    SELECTED_NATIVE_RELEASE, lightingIdentity, 'seven-visual-finishes-v1', OCCUPIED_SELECTED_FINISH_ETAG, withFinishes,
  ])}`;
  if (!selectedHead?.scope) return {...selected, candidate: withFinishes, projectionIdentity: finishIdentity};
  if (selectedHead.scope !== OCCUPIED_CANNON_SCOPE) return unavailable();

  const candidateWithCannon = projectSelectedCannon(withFinishes, finishHead.candidate);
  return bindScopedSelection(selected, candidateWithCannon, finishIdentity, match, selectedHead);
}

type ScopedSelectedHead = Extract<NonNullable<NativeDetailContext['selectedHead']>, {scope: string}>;
function bindScopedSelection(selected: ReturnType<typeof composeSelectedScene>, candidate: Exhibition,
  predecessor: string, match: string, head: ScopedSelectedHead): SelectedNativeRelease {
  const projectionIdentity = scopedProjectionIdentity(candidate, predecessor, match, head.scope);
  if (projectionIdentity !== head.projectionIdentity) return unavailable();
  return {...selected, candidate, projectionIdentity};
}

function scopedProjectionIdentity(candidate: Exhibition, predecessor: string, match: string, scope: ScopedSelectedHead['scope']): SelectedProjectionIdentity {
  return `v1:${fingerprintCanonical([SELECTED_NATIVE_RELEASE, predecessor, scope, match, candidate])}`;
}

const fingerprintCanonical = (value: unknown) => createHash('sha256').update(freezeCanonical(value)).digest('hex');

/** Append the one existing saved Cannon spot to the accepted seven-finish scene. */
export function projectSelectedCannon(selected: Exhibition, saved: Exhibition): Exhibition {
  if (fingerprintCanonical(selected) !== acceptedSevenFinishesScene) return unavailable();

  const lights = saved.lights.filter(row => row.id === cannonId);
  const byLight = (row: {lightId: string}) => row.lightId === cannonId;
  const details = lightDetailsFor(saved).filter(byLight);
  const attachments = lightAttachmentsFor(saved).filter(byLight);
  const [light] = lights, [detail] = details, [attachment] = attachments;
  if (lights.length !== 1 || details.length !== 1 || attachments.length !== 1 ||
      !light || light.type !== 'spot' || !detail || !attachment ||
      fingerprintCanonical([light, detail, attachment]) !== cannonCommitment ||
      furnishingsFor(saved)?.bindings.some(row => row.hostKind === 'light' && row.hostId === cannonId))
    return unavailable();

  const target = selected.placements.find(row => row.id === light.targetPlacementId);
  const ceiling = selected.surfaces.find(row => row.id === attachment.surfaceId);
  if (!target || target.roomId !== light.roomId || !ceiling || ceiling.type !== 'ceiling' || ceiling.roomId !== light.roomId ||
      !isDeepStrictEqual(target, saved.placements.find(row => row.id === target.id)) ||
      !isDeepStrictEqual(ceiling, saved.surfaces.find(row => row.id === ceiling.id)))
    return unavailable();
  return appendSelectedCeilingSpot(selected, light, detail, attachment);
}

/** Replay only the product default on the five same room bases. The loader
 * has already bound both the historical draft and the current owner/ETag. */
function projectSelectedRoomLighting(selected: Exhibition, prior: Draft, successor: Draft): Exhibition {
  const selectedBindings = lightDetailsFor(selected);
  const bases = lightDetailsFor(prior.candidate).filter(binding => binding.purpose === 'room-base');
  if (bases.length !== 5 || prior.candidate.rooms.length !== 5 || selected.rooms.length !== 5 ||
      selectedBindings.filter(binding => binding.purpose === 'room-base').length !== bases.length)
    return unavailable();

  const brightness = ROOM_CEILING_FILL_INITIAL_BRIGHTNESS;
  let expected = prior.candidate;
  let projected = selected;
  for (const binding of bases) {
    const light = prior.candidate.lights.find(value => value.id === binding.lightId);
    const retained = selected.lights.find(value => value.id === binding.lightId);
    if (!light || light.type !== 'area' || binding.basePlacement !== 'auto' ||
        !isDeepStrictEqual(binding.ceilingFill, {version: 1, brightness}) ||
        !isDeepStrictEqual(light, retained) ||
        !isDeepStrictEqual(binding, selectedBindings.find(value => value.lightId === binding.lightId)))
      return unavailable();

    try {
      expected = applyLightObjectCommand(expected, {
        type: 'set-room-ceiling-fill-brightness', lightId: light.id, brightness, mode: 'default',
      }, {verifiedBaseline: expected}).candidate;
      projected = setRoomCeilingFillBrightness(projected, light.id, brightness, 'default');
    } catch {
      return unavailable();
    }
    const authored = expected.lights.find(value => value.id === binding.lightId);
    if (!isDeepStrictEqual(authored, projected.lights.find(value => value.id === binding.lightId)))
      return unavailable();
  }
  if (successor.editVersion !== prior.editVersion + bases.length ||
      !isDeepStrictEqual({...prior, editVersion: successor.editVersion, updatedAt: successor.updatedAt, candidate: expected}, successor))
    return unavailable();
  return projected;
}

function appendCaptionStands(candidate: Exhibition, descriptor: WorkspaceFurnishingDescriptor,
  stands: WorkspaceFurnishingPlacement[]): Exhibition {
  const next = structuredClone(candidate);
  const workspace = next.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings | undefined;
  if (workspace?.version !== 11) return unavailable();
  workspace.furnishings.push(structuredClone(descriptor));
  workspace.placements.push(...structuredClone(stands));
  if (!validateWorkspaceFurnishings(next).valid) return unavailable();
  return next;
}

/** Reuse only the two saved, installed supports. Compare the entire authored
 * candidate so an unrelated draft change cannot enter the Greek release. */
function projectSelectedCaptionStands(candidate: Exhibition, before: Exhibition, current: Exhibition): Exhibition {
  const descriptor = installedFurnishingDescriptorFor(captionStandId);
  const base = before.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings | undefined;
  const saved = current.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings | undefined;
  if (!descriptor || base?.version !== 11 || saved?.version !== 11) return unavailable();
  const stands = saved.placements.slice(base.placements.length);
  if (stands.length !== captionStandTargets.length || !isDeepStrictEqual(appendCaptionStands(before, descriptor, stands), current))
    return unavailable();

  const sourcePlaques = plaquesFor(current);
  const greekPlaques = plaquesFor(candidate);
  const reviews = captionStandTargets.map(({stand: standId, plaque: plaqueId}, index) => {
    const stand = stands[index]!;
    const plaque = sourcePlaques.find(row => row.id === plaqueId);
    if (stand.id !== standId || stand.furnishingId !== descriptor.id || stand.furnishingVersion !== descriptor.version ||
        stand.scale !== 1 || !plaque || plaque.roomId !== stand.roomId || plaque.source.kind !== 'artwork' ||
        !isDeepStrictEqual(plaque, greekPlaques.find(row => row.id === plaqueId)))
      return unavailable();
    return [stand.id, plaque.id, plaque.source.placementId, stand.position, stand.yaw, plaque.position, plaque.rotation];
  });
  if (fingerprint(reviews) !== captionStandsCommitment) return unavailable();
  return appendCaptionStands(candidate, descriptor, stands);
}

export function projectGreekOnAcceptedArtworkSpots(baseline: Exhibition, current: Exhibition): Exhibition {
  if (createHash('sha256').update(freezeCanonical(baseline)).digest('hex') !== greekPriorScene)
    return unavailable();
  return projectSelectedGreekSpot(retireSelectedSculpturePoint(baseline, current, sculpturePointRetirement), current);
}

/** Add the one saved ceiling spot to the already validated point/base projection. */
function projectSelectedGreekSpot(pointRetired: Exhibition, current: Exhibition): Exhibition {
  const byLight = (row: {lightId: string}) => row.lightId === greekSpotId;
  const light = current.lights.find(row => row.id === greekSpotId);
  const detailRows = lightDetailsFor(current).filter(byLight);
  const attachmentRows = lightAttachmentsFor(current).filter(byLight);
  const [detail] = detailRows, [attachment] = attachmentRows;
  const ceiling = pointRetired.surfaces.find(row => row.id === greekCeilingId);
  const placement = pointRetired.placements.find(row => row.id === greekPlacementId);
  if (!light || light.type !== 'spot' || light.targetPlacementId !== greekPlacementId || !placement ||
      !ceiling || ceiling.type !== 'ceiling' || ceiling.roomId !== placement.roomId || light.roomId !== placement.roomId ||
      !isDeepStrictEqual(ceiling, current.surfaces.find(row => row.id === greekCeilingId)) ||
      !isDeepStrictEqual(placement, current.placements.find(row => row.id === greekPlacementId)) ||
      detailRows.length !== 1 || !detail || detail.aim?.kind !== 'placement-center' || detail.trackAim ||
      attachmentRows.length !== 1 || !attachment || attachment.surfaceId !== greekCeilingId ||
      furnishingsFor(current)?.bindings.some(row => row.hostKind === 'light' && row.hostId === greekSpotId))
    return unavailable();
  const artwork = (scene: Exhibition) => scene.artworks.find(row => row.revisionId === placement.artworkRevisionId);
  const source = artwork(current), retained = artwork(pointRetired);
  if (!source || !retained || !isDeepStrictEqual(source.dimensions, retained.dimensions) ||
      !isDeepStrictEqual(source.transform, retained.transform) ||
      ![source, retained].every(row => row.assets.some(asset => asset.id === placement.assetId && asset.sha256 === greekModel)))
    return unavailable();
  const withoutReferences = (value: object, ...keys: string[]) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const commitment = createHash('sha256').update(freezeCanonical([
    withoutReferences(light, 'id', 'roomId', 'targetPlacementId'),
    withoutReferences(detail, 'lightId'),
    withoutReferences(attachment, 'lightId', 'surfaceId'),
  ])).digest('hex');
  const details = lightDetailsFor(pointRetired), attachments = lightAttachmentsFor(pointRetired);
  if (commitment !== greekSpotCommitment || pointRetired.lights.some(row => row.type === 'point' || row.id === greekSpotId) ||
      pointRetired.lights.filter(row => row.type === 'area').length !== 5 ||
      pointRetired.lights.filter(row => row.type === 'spot').length !== 5 ||
      details.some(byLight) || attachments.some(byLight)) return unavailable();
  return appendSelectedCeilingSpot(pointRetired, light, detail, attachment);
}

function appendSelectedCeilingSpot(selected: Exhibition, light: Exhibition['lights'][number],
  detail: ReturnType<typeof lightDetailsFor>[number], attachment: ReturnType<typeof lightAttachmentsFor>[number]): Exhibition {
  const next = structuredClone(selected);
  next.lights.push(structuredClone(light));
  next.extensions = {
    ...next.extensions,
    [LIGHT_DETAILS_NAMESPACE]: {version: 1, lights: [...lightDetailsFor(selected), structuredClone(detail)]} as unknown as NonNullable<Exhibition['extensions']>[string],
    [LIGHT_ATTACHMENT_NAMESPACE]: {version: 1, lights: [...lightAttachmentsFor(selected), structuredClone(attachment)]} as unknown as NonNullable<Exhibition['extensions']>[string],
  };
  if (!validateStudioLightDetails(next).valid || !validateLightAttachments(next).valid) return unavailable();
  return next;
}

/** Omit only the committed old point and adopt the saved purpose of its existing area emitter. */
function retireSelectedSculpturePoint(candidate: Exhibition, current: Exhibition, commitment: string): Exhibition {
  const points = candidate.lights.filter(light => light.type === 'point');
  const point = points[0];
  if (points.length !== 1 || !point || current.lights.some(light => light.id === point.id))
    return unavailable();

  const details = lightDetailsFor(candidate);
  const pointDetail = details.find(row => row.lightId === point.id && row.purpose === 'room-base');
  const fillDetails = details.filter(row => row.purpose === 'room-supplemental-fill' &&
    candidate.lights.some(light => light.id === row.lightId && light.roomId === point.roomId && light.type === 'area'));
  const fillDetail = fillDetails[0];
  const fill = candidate.lights.find(light => light.id === fillDetail?.lightId);
  const savedFill = current.lights.find(light => light.id === fill?.id);
  const savedDetail = lightDetailsFor(current).find(row => row.lightId === fill?.id);
  if (!pointDetail || fillDetails.length !== 1 || !fillDetail || !fill ||
      !isDeepStrictEqual(savedFill, fill) || !isDeepStrictEqual(savedDetail, {...fillDetail, purpose: 'room-base'}))
    return unavailable();

  const committed = freezeCanonical([SELECTED_NATIVE_RELEASE, 'sculpture-point-retirement-v1',
    point, pointDetail, fill, fillDetail, savedDetail]);
  if (createHash('sha256').update(committed).digest('hex') !== commitment)
    return unavailable();

  const next: Exhibition = {
    ...candidate,
    lights: candidate.lights.filter(light => light.id !== point.id),
    extensions: {
      ...candidate.extensions,
      [LIGHT_DETAILS_NAMESPACE]: {
        version: 1,
        lights: details.filter(row => row.lightId !== point.id)
          .map(row => row.lightId === fill.id ? {...row, purpose: 'room-base'} : row),
      } as unknown as NonNullable<Exhibition['extensions']>[string],
    },
  };
  if (freezeCanonical(next).toLowerCase().includes(point.id.toLowerCase()) || !validateStudioLightDetails(next).valid)
    return unavailable();
  return next;
}

export function artworkSpotProjectionIdentity(match: string, candidate: Exhibition): SelectedProjectionIdentity {
  return `v1:${createHash('sha256').update(freezeCanonical([
    SELECTED_NATIVE_RELEASE, artworkSpotProjection, baselineHeadFingerprint, match, approvedFloorSounds.commitment, candidate,
  ])).digest('hex')}`;
}

function railForSpot(scene: Exhibition, id: string) {
  const workspace = scene.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings | undefined;
  const placement = workspace?.placements.find(row => row.id === id);
  const ceiling = workspace?.ceilingAttachments?.find(row => row.placementId === id);
  const furnishing = workspace?.furnishings.find(row => row.id === placement?.furnishingId);
  if (!placement || !ceiling || !furnishing || furnishing.kind !== 'ceiling-rail') return unavailable();
  return {placement, ceiling, furnishing};
}

function spotForPlacement(scene: Exhibition, placementId: string) {
  const rows = lightDetailsFor(scene).filter(row => row.trackAim?.aim.kind === 'placement-center' &&
    row.trackAim.aim.placementId === placementId);
  if (!rows.length) return null;
  const detail = rows[0]!;
  const track = detail.trackAim;
  const light = scene.lights.find(row => row.id === detail.lightId);
  const visuals = furnishingsFor(scene);
  const visual = visuals?.bindings.find(row => row.hostKind === 'light' && row.hostId === detail.lightId);
  const asset = visuals?.assets.find(row => row.id === visual?.assetId);
  if (rows.length !== 1 || !track || track.aim.kind !== 'placement-center' || !light || light.type !== 'spot' ||
      !visual || asset?.sha256 !== articulatedHead || lightAttachmentsFor(scene).some(row => row.lightId === light.id))
    return unavailable();
  const rail = railForSpot(scene, track.mount.railPlacementId);
  const resolved = resolveTrackSpotAiming(scene, light.id);
  if (!resolved.reachable) return unavailable();
  const withoutReferences = (value: object, ...keys: string[]) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const emitter = withoutReferences(light, 'id', 'roomId', 'transform');
  const optics = withoutReferences(detail, 'lightId', 'trackAim');
  const slot = withoutReferences(track.mount, 'railPlacementId');
  const aim = withoutReferences(track.aim, 'placementId');
  const {anchor, yaw, gap} = rail.ceiling;
  const transform = {position: resolved.emitter, rotation: resolved.headPose.rotation, scale: [1, 1, 1]};
  const commitment = createHash('sha256').update(freezeCanonical([
    emitter, optics, slot, aim, visual.pose, {anchor, yaw, gap}, transform,
  ])).digest('hex');
  return {light, detail, track, visual, asset, rail, commitment};
}

/** Only the exact authored heads admitted above can use this product projection.
 * Reuse the public baseline's three rails and existing articulated visual asset. */
export function projectSelectedArtworkSpots(baseline: Exhibition, current: Exhibition): Exhibition {
  const next = structuredClone(baseline);
  const details = lightDetailsFor(next);
  const visuals = furnishingsFor(next);
  if (!visuals) return unavailable();
  for (const approved of artworkSpots) {
    const placement = baseline.placements.find(row => row.id === approved.placement);
    if (!placement ||
        !isDeepStrictEqual(placement, current.placements.find(row => row.id === placement.id))) return unavailable();
    const before = spotForPlacement(baseline, placement.id);
    const after = spotForPlacement(current, placement.id);
    if ((before?.commitment ?? null) !== approved.before || !after || after.commitment !== approved.after ||
        (before && before.light.id !== approved.light) || after.light.id !== approved.light || after.rail.placement.id !== approved.rail ||
        after.rail.furnishing.model.sha256 !== approved.railModel) return unavailable();
    const retainedRail = railForSpot(baseline, after.rail.placement.id);
    if (!isDeepStrictEqual(retainedRail, after.rail) || retainedRail.placement.roomId !== placement.roomId)
      return unavailable();
    const retainedHead = visuals.assets.find(row => row.sha256 === articulatedHead);
    if (!retainedHead || !isDeepStrictEqual(retainedHead, {...after.asset, id: retainedHead.id,
      path: retainedHead.path, rights: {...after.asset.rights, notice: {...after.asset.rights.notice, path: retainedHead.rights.notice.path}}}))
      return unavailable();
    const id = approved.light;
    if (next.lights.some(row => row.id === id) !== !!before ||
        details.some(row => row.lightId !== id && isDeepStrictEqual(row.trackAim?.mount, after.track.mount)))
      return unavailable();
    const light = structuredClone({...after.light, id}), detail = structuredClone({...after.detail, lightId: id});
    const visual = structuredClone({...after.visual, hostId: id, assetId: retainedHead.id});
    if (before) {
      next.lights[next.lights.findIndex(row => row.id === id)] = light;
      details[details.findIndex(row => row.lightId === id)] = detail;
      visuals.bindings[visuals.bindings.findIndex(row => row.hostKind === 'light' && row.hostId === id)] = visual;
    } else {
      next.lights.push(light);
      details.push(detail);
      visuals.bindings.push(visual);
    }
  }
  next.extensions = {
    ...next.extensions,
    [LIGHT_DETAILS_NAMESPACE]: {version: 1, lights: details} as unknown as NonNullable<Exhibition['extensions']>[string],
    [FURNISHING_NAMESPACE]: visuals as unknown as NonNullable<Exhibition['extensions']>[string],
  };
  if (!validateStudioLightDetails(next).valid || !validateFurnishings(next).valid) return unavailable();
  return next;
}

/** Add only two committed bindings to the existing selected scene. The normal
 * publication path still validates the live registration and export rights. */
function addSelectedBrassFrames(candidate: Exhibition, current: Exhibition, approved: ApprovedBrassFrames) {
  const held = candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings | undefined;
  const source = current.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings | undefined;
  if (!held?.frameAttachments || !source?.frameAttachments || source.version !== held.version ||
      !validateWorkspaceFurnishings(current).valid)
    return unavailable();
  const oldFrames = new Set(held.frameAttachments.map(frame => frame.placementId));
  const savedFrames = new Map(source.frameAttachments.map(frame => [frame.placementId, frame]));
  const additional = source.frameAttachments.filter(frame => !oldFrames.has(frame.placementId));
  const expected = new Set(approved);
  if (expected.size !== 2 || additional.length !== 2 || savedFrames.size !== oldFrames.size + 2 ||
      !held.frameAttachments.every(frame => isDeepStrictEqual(frame, savedFrames.get(frame.placementId))))
    return unavailable();
  for (const frame of additional) {
    const registered = held.furnishings.find(item => item.id === frame.furnishingId);
    const saved = source.furnishings.find(item => item.id === frame.furnishingId);
    if (!registered || !isDeepStrictEqual(registered, saved) ||
        frame.modelSha256 !== '4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4' ||
        frame.imageFit?.profile !== 'contain-contact-v1')
      return unavailable();
    const commitment = createHash('sha256').update(freezeCanonical([SELECTED_NATIVE_RELEASE, frame, registered])).digest('hex');
    if (!expected.delete(commitment)) return unavailable();
  }
  candidate.extensions = {
    ...candidate.extensions,
    [WORKSPACE_FURNISHING_NAMESPACE]: {
      ...held, frameAttachments: [...held.frameAttachments, ...structuredClone(additional)],
    } as unknown as NonNullable<Exhibition['extensions']>[string],
  };
  if (!validateWorkspaceFurnishings(candidate).valid) return unavailable();
}

function floorRegistration(scene: Exhibition, surfaceId: string) {
  const workspace = scene.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings | undefined;
  const binding = workspace?.bindings.find(row => row.surfaceId === surfaceId);
  const material = workspace?.materials.find(row => row.id === binding?.materialId && row.version === binding?.materialVersion);
  if (binding && !material) return unavailable();
  return binding ? {binding, material} : null;
}

/** Select sound only. The regular publication pipeline still checks the
 * retained resource bytes, notices, and current owner-scoped material rights. */
function addSelectedFootsteps(candidate: Exhibition, current: Exhibition, approved: ApprovedFootsteps) {
  const {paintingTarget, entranceTarget, commitment} = approved;
  const painting = candidate.surfaces.find(row => row.type === 'floor' && footstepTarget('painting', row.id) === paintingTarget);
  const entrance = candidate.surfaces.find(row => row.type === 'floor' && footstepTarget('entrance', row.id) === entranceTarget);
  const experience = experienceFor(candidate);
  if (!painting || !entrance || painting.id === entrance.id || experience.footsteps.length !== 0 ||
      candidate.extensions?.[FLOOR_NAMESPACE] !== undefined || candidate.extensions?.[FOOTSTEP_RESOURCE_NAMESPACE] !== undefined)
    return unavailable();

  const registrations = [painting, entrance].map(surface => {
    const registered = floorRegistration(current, surface.id);
    if (!isDeepStrictEqual(surface, current.surfaces.find(row => row.id === surface.id)) ||
        !isDeepStrictEqual(registered, floorRegistration(candidate, surface.id)))
      return unavailable();
    return registered;
  });
  const wood = floorFor(current, {roomId: painting.roomId, surfaceId: painting.id});
  const steps = experienceFor(current).footsteps;
  const stone = {surfaceId: entrance.id, material: 'stone'} as const;
  const resources = {version: 1, families: ['wood']};
  if (wood?.preset !== 'wood' || wood.target.kind !== 'surface' || wood.target.surfaceId !== painting.id ||
      !isDeepStrictEqual(wood.sound, {mode: 'material-default', gain: 1}) ||
      floorFor(current, {roomId: entrance.roomId, surfaceId: entrance.id}) ||
      !isDeepStrictEqual(steps.filter(row => row.surfaceId === painting.id || row.surfaceId === entrance.id), [stone]) ||
      !isDeepStrictEqual(current.extensions?.[FOOTSTEP_RESOURCE_NAMESPACE], resources))
    return unavailable();
  const records = [SELECTED_NATIVE_RELEASE, 'approved-floor-sounds-v1', painting, entrance,
    registrations, wood, stone, footstepResourcesFor(current)];
  if (createHash('sha256').update(freezeCanonical(records)).digest('hex') !== commitment) return unavailable();

  experience.footsteps = [{surfaceId: painting.id, material: 'wood'}, stone];
  candidate.extensions = {
    ...candidate.extensions,
    [EXPERIENCE_NAMESPACE]: experience as unknown as NonNullable<Exhibition['extensions']>[string],
    [FOOTSTEP_RESOURCE_NAMESPACE]: resources,
  };
  if (!validateViewerExperience(candidate).valid) return unavailable();
}

/** Compose the approved fields using authored IDs in the same exhibition.
 * All other fields are inherited directly from the saved presentation. */
export function composeSelectedScene(
  baseline: Exhibition, current: Exhibition, approvedBrassFrames?: ApprovedBrassFrames, approvedFootsteps?: ApprovedFootsteps,
) {
  const entrance = current.extensions?.[ENTRANCE_NAMESPACE];
  const wheat = baseline.artworks.flatMap(artwork => artwork.assets)
    .find(asset => asset.id === entrance?.imageAssetId && asset.mime === 'image/png');
  if (!entrance || wheat?.sha256 !== entranceImage || !validateViewerEntrance(current).valid)
    return unavailable();

  const oldWall = wallFinishesFor(baseline).find(wall => selectedBaseboardWall(wall.surfaceId));
  const newWall = wallFinishesFor(current).find(wall => selectedBaseboardWall(wall.surfaceId));
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
  if (approvedBrassFrames) addSelectedBrassFrames(candidate, current, approvedBrassFrames);
  if (approvedFootsteps) addSelectedFootsteps(candidate, current, approvedFootsteps);
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
