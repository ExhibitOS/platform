// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  FOOTSTEP_FAMILIES, FOOTSTEP_RESOURCE_NAMESPACE, FOOTSTEP_SAMPLES, footstepResourcesFor,
  type FootstepFamily,
} from '@exhibitos/spec/footstep-resources';
import type {Exhibition} from '@exhibitos/spec';
import {experienceFor, type ViewerExperience} from './experience.js';
import {floorFor} from './floors.js';

type FootstepBank = readonly [string, string, ...string[]];
function stockBank(family: FootstepFamily): FootstepBank {
  const [first, second, ...rest] = FOOTSTEP_SAMPLES.filter(sample => sample.family === family).map(sample => sample.sha256);
  if (!first || !second) throw Error('FOOTSTEP_RESOURCE_SELECTION');
  return Object.freeze([first, second, ...rest] as const);
}
export const BUILTIN_STEP_BANKS = Object.freeze(Object.fromEntries(FOOTSTEP_FAMILIES.map(family => [family, stockBank(family)]))) as Readonly<Record<FootstepFamily, FootstepBank>>;
export const BUILTIN_STEP_BYTES: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(
  FOOTSTEP_SAMPLES.map(sample => [sample.sha256, sample.bytes]),
));

type StepEntry = Pick<ViewerExperience['footsteps'][number], 'surfaceId' | 'assetId' | 'bank'> & {material: string};
type StepDocument = Pick<Exhibition, 'extensions' | 'surfaces'>;

function declaredFamilies(document: Pick<Exhibition, 'extensions'>): FootstepFamily[] {
  footstepResourcesFor(document);
  const choice = document.extensions?.[FOOTSTEP_RESOURCE_NAMESPACE] as {families: FootstepFamily[]} | undefined;
  return choice?.families ?? [];
}

export function declareFootstepFamily(document: Exhibition, family: FootstepFamily): void {
  const families = [...new Set([...declaredFamilies(document), family])].sort();
  document.extensions = {...document.extensions, [FOOTSTEP_RESOURCE_NAMESPACE]: {version: 1, families}};
}

function resolveFloorSound(document: StepDocument, families: ReadonlySet<FootstepFamily>,
  roomId: string | undefined, surfaceId: string | undefined, entry: StepEntry | undefined) {
  const binding = roomId ? floorFor(document, {roomId, surfaceId}) : undefined;
  const sound = binding?.sound;
  if (sound?.mode === 'none') return {kind: 'none' as const, gain: 0, material: binding!.preset};
  if (sound?.mode === 'explicit')
    return {kind: 'publication' as const, ids: sound.assetIds, gain: sound.gain, material: binding!.preset};
  // Separate authored experience recordings continue to win over material defaults.
  if (entry?.bank)
    return {kind: 'publication' as const, ids: entry.bank.map(row => row.assetId), gain: sound?.gain ?? 1, material: entry.material};
  if (entry?.assetId)
    return {kind: 'publication' as const, ids: [entry.assetId], gain: sound?.gain ?? 1, material: entry.material};
  if (sound?.mode === 'material-default') {
    const family = binding!.preset;
    if (families.has(family))
      return {kind: 'builtin' as const, ids: BUILTIN_STEP_BANKS[family], gain: sound.gain, material: family};
    return {kind: 'unlinked-default' as const, gain: sound.gain, material: family};
  }
  const family = entry?.material;
  if ((family === 'wood' || family === 'carpet' || family === 'concrete') && families.has(family))
    return {kind: 'builtin' as const, ids: BUILTIN_STEP_BANKS[family], gain: 1, material: family};
  return {kind: 'unassigned' as const, gain: 0, material: family};
}

export function resolveFootsteps(document: StepDocument, roomId: string | undefined, surfaceId: string | undefined, entry: StepEntry | undefined) {
  let families: FootstepFamily[] = [];
  try { families = declaredFamilies(document); } catch { /* Legacy preview remains available. */ }
  const result = resolveFloorSound(document, new Set(families), roomId, surfaceId, entry);
  if (result.kind === 'unlinked-default' || result.kind === 'unassigned')
    return {kind: 'none' as const, gain: 0, material: result.material ?? ''};
  return result;
}

/** One result for the same floor targets used by the renderer, including a
 * room-base only in rooms that have no authored floor surface. */
export function recordedFloorScopes(document: Exhibition) {
  const families = new Set(declaredFamilies(document));
  const authored = experienceFor(document).footsteps;
  return document.rooms.flatMap(room => {
    const surfaces = document.surfaces.filter(surface => surface.type === 'floor' && surface.roomId === room.id);
    const targets = surfaces.length ? surfaces.map(surface => surface.id) : [undefined];
    return targets.map(surfaceId => ({
      roomId: room.id, surfaceId,
      sound: resolveFloorSound(document, families, room.id, surfaceId, authored.find(row => row.surfaceId === surfaceId)),
    }));
  });
}

export interface FloorRecordingStatus {
  roomId: string;
  surfaceId?: string;
  material?: string;
  state: 'recorded' | 'muted' | 'unassigned' | 'missing';
  source?: 'stock' | 'explicit';
  issueCode?: string;
}

export function floorRecordingStatus(scope: ReturnType<typeof recordedFloorScopes>[number]): FloorRecordingStatus {
  const {roomId, surfaceId, sound} = scope;
  const target = {roomId, ...(surfaceId && {surfaceId}), ...(sound.material && {material: sound.material})};
  switch (sound.kind) {
    case 'builtin': return {...target, state: 'recorded', source: 'stock'};
    case 'publication': return {...target, state: 'recorded', source: 'explicit'};
    case 'none': return {...target, state: 'muted'};
    case 'unlinked-default': return {...target, state: 'missing', source: 'stock', issueCode: 'FLOOR_RECORDING_UNLINKED'};
    case 'unassigned': return {...target, state: 'unassigned'};
  }
}
