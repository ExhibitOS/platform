// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactBounds, artifactCorners, artifactPoint, validateArtifactPose, type AffinePoint} from './artifact-affine.js';
import {ARCHITECTURAL_FINISH_NAMESPACE, type ArchitecturalFinishes, type WallFinish} from './architectural-finishes.js';
import {benchSolids} from './bench-geometry.js';
import {furnishingsFor} from './furnishings.js';
import {resolveInstallations} from './installation-resolver.js';
import {surfacePanels} from './surface-panels.js';
import {builtInStoolSolids, WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishings} from './workspace-furnishing.js';

export const PAIRED_WALL_STRUCTURE_NAMESPACE = 'org.exhibitos.studio/paired-wall-structure';
export const PAIRED_WALL_STRUCTURE_PROFILE = 'saved-head-paired-wall-structure-v1';
export const MAX_PAIRED_WALL_EXTENSION_METERS = 0.12;
export interface PairedWallExtent {
  openingId: string;
  peerOpeningId: string;
  side: 'positive-normal' | 'negative-normal';
  extensionMeters: number;
  revealFinish?: 'painted-edge';
}
export interface PairedWallStructure {version: 1; pairs: PairedWallExtent[]}
export type PairedWallStructureCommand = ({type: 'set-paired-wall-structure'; revealFinish?: 'painted-edge' | null}
  & Omit<PairedWallExtent, 'revealFinish'>)
  | ({type: 'remove-paired-wall-structure'} & Pick<PairedWallExtent, 'openingId' | 'peerOpeningId'>);

type Scene = Pick<Exhibition, 'extensions' | 'openings'>;
const epsilon = 1e-5;
const minPassage = {width: 0.52, height: 1.77};
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sub = (a: AffinePoint, b: AffinePoint): AffinePoint => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a: AffinePoint, b: AffinePoint) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const near = (a: number, b: number) => Math.abs(a-b) < epsilon;
const invalid = () => new Error('PAIRED_WALL_STRUCTURE_INVALID');
function closed(value: unknown, fields: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && Object.keys(value).length === fields.length
    && fields.every(key => Object.hasOwn(value, key));
}
function settings(scene: Pick<Exhibition, 'extensions'>): PairedWallStructure | undefined {
  const value = scene.extensions?.[PAIRED_WALL_STRUCTURE_NAMESPACE];
  if (value === undefined) return;
  if (!closed(value, ['version', 'pairs']) || value.version !== 1 || !Array.isArray(value.pairs)
    || value.pairs.length === 0 || value.pairs.length > 10) throw invalid();
  for (const row of value.pairs) {
    const fields = ['openingId','peerOpeningId','side','extensionMeters'];
    if (row && typeof row === 'object' && Object.hasOwn(row, 'revealFinish')) fields.push('revealFinish');
    if (!closed(row, fields) || !uuid(row.openingId) || !uuid(row.peerOpeningId)
      || (fields.includes('revealFinish') && row.revealFinish !== 'painted-edge')
      || (row.side !== 'positive-normal' && row.side !== 'negative-normal')
      || typeof row.extensionMeters !== 'number' || !Number.isFinite(row.extensionMeters)
      || row.extensionMeters <= 0 || row.extensionMeters > MAX_PAIRED_WALL_EXTENSION_METERS) throw invalid();
  }
  return value as unknown as PairedWallStructure;
}

export function pairedWallStructuralSpan(scene: Scene, surfaceId: string, depth: number) {
  const extent = settings(scene)?.pairs.find(row =>
    scene.openings.some(opening => same(opening.id, row.openingId) && same(opening.surfaceId, surfaceId)));
  const half = depth / 2;
  return {
    minZ: -half - (extent?.side === 'negative-normal' ? extent.extensionMeters : 0),
    maxZ: half + (extent?.side === 'positive-normal' ? extent.extensionMeters : 0),
  };
}

function wallSide(scene: Exhibition, openingId: string) {
  const opening = scene.openings.find(row => same(row.id, openingId));
  const wall = opening && scene.surfaces.find(row => same(row.id, opening.surfaceId));
  const room = wall && scene.rooms.find(row => same(row.id, wall.roomId));
  const finishes = scene.extensions?.[ARCHITECTURAL_FINISH_NAMESPACE] as unknown as ArchitecturalFinishes | undefined;
  const finish = wall && finishes?.walls.find(row => same(row.surfaceId, wall.id));
  if (!opening || opening.type !== 'door' || !wall || wall.type !== 'wall' || !room || !finish) throw invalid();

  for (const pose of [wall.transform, room.transform]) {
    validateArtifactPose(pose);
    if (pose.scale.some(value => !near(value, 1))) throw invalid();
  }
  const point = (local: AffinePoint) => artifactPoint(local, wall.transform, room.transform);
  const ray = (axis: AffinePoint) => sub(point(axis), point([0,0,0]));
  const normal = ray([0,0,1]), tangent = ray([1,0,0]), up = ray([0,1,0]);
  const bottom = point([opening.offset[0], opening.offset[1]-opening.dimensions.height/2, 0]);
  const inward = dot(sub(room.transform.position, bottom), normal);
  if (!near(up[1],1) || !near(normal[1],0) || !near(bottom[1],room.transform.position[1])
      || Math.abs(inward) < epsilon || opening.dimensions.width < minPassage.width || opening.dimensions.height < minPassage.height) throw invalid();
  return {opening, wall, room, finish, bottom, tangent, normal, inward};
}

function paintedRevealSource(first: WallFinish, second: WallFinish): WallFinish {
  if (first.preset === 'painted-edge' && second.preset === 'plain') return first;
  if (second.preset === 'painted-edge' && first.preset === 'plain') return second;
  throw invalid();
}

/** The opted-in return borrows the pair's authored paint finish from either viewing side. */
export function pairedWallRevealFinish(scene: Exhibition, openingId: string): WallFinish | undefined {
  const extent = settings(scene)?.pairs.find(row => same(row.openingId, openingId) || same(row.peerOpeningId, openingId));
  if (!extent?.revealFinish) return;
  const first = wallSide(scene, extent.openingId), second = wallSide(scene, extent.peerOpeningId);
  return structuredClone(paintedRevealSource(first.finish, second.finish));
}

function extraPanelBounds(scene: Exhibition, extent: PairedWallExtent, used: Set<string>) {
  const side = wallSide(scene, extent.openingId), peer = wallSide(scene, extent.peerOpeningId);
  const {opening,wall,room,finish,normal,inward} = side;
  if (!opening.connectsToOpeningId || !peer.opening.connectsToOpeningId
    || !same(opening.connectsToOpeningId, peer.opening.id) || !same(peer.opening.connectsToOpeningId, opening.id)
    || same(room.id, peer.room.id) || used.has(wall.id.toLowerCase()) || used.has(peer.wall.id.toLowerCase())) throw invalid();
  used.add(wall.id.toLowerCase());
  used.add(peer.wall.id.toLowerCase());

  const offset = sub(peer.bottom, side.bottom);
  const gap = dot(offset, normal);
  const sign = extent.side === 'positive-normal' ? 1 : -1;
  if (sign !== Math.sign(inward) || !near(Math.abs(dot(normal,peer.normal)),1)
    || Math.sign(inward) === Math.sign(dot(peer.normal, normal)*peer.inward)
    || !near(dot(offset, side.tangent),0) || !near(offset[1],0)
    || !near(opening.dimensions.width,peer.opening.dimensions.width) || !near(opening.dimensions.height,peer.opening.dimensions.height)
    || Math.abs(gap) >= (finish.depth + peer.finish.depth)/2 - epsilon) throw invalid();

  const openings = scene.openings.filter(item => same(item.surfaceId, wall.id) || same(item.surfaceId, peer.wall.id));
  if (extent.revealFinish) {
    if (openings.length !== 2) throw invalid();
    paintedRevealSource(finish, peer.finish);
  }
  const affectedOpening = (id: string) => openings.some(item => same(item.id,id));
  const workspace = scene.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings | undefined;
  if (workspace?.openingAttachments?.some(item => affectedOpening(item.openingId))
    || furnishingsFor(scene)?.bindings.some(item => item.hostKind === 'opening' && affectedOpening(item.hostId))) throw invalid();

  const depth = extent.extensionMeters, half = finish.depth/2;
  const plane = (value: AffinePoint) => artifactPoint(value, wall.transform);
  const bottomInRoom = plane([opening.offset[0], opening.offset[1]-opening.dimensions.height/2, sign*(half+depth)]);
  if (Math.abs(bottomInRoom[0]) > room.dimensions.width/2 || Math.abs(bottomInRoom[2]) > room.dimensions.depth/2) throw invalid();
  return surfacePanels(wall, scene.openings).map(panel => artifactBounds(artifactCorners(
    {width:panel.width, height:panel.height, depth},
    [{position:[panel.x,panel.y,sign*(half+depth/2)],rotation:[0,0,0,1],scale:[1,1,1]}, wall.transform, room.transform],
  )));
}

export function validatePairedWallStructure(scene: Exhibition) {
  try {
    const value = settings(scene);
    if (!value) return {valid:true,errors:[]};
    const used = new Set<string>();
    const added = value.pairs.flatMap(row => extraPanelBounds(scene,row,used));
    const furnishings = [
      ...resolveInstallations(scene).flatMap(item => item.solids),
      ...benchSolids(scene),
      ...builtInStoolSolids(scene),
    ].map(item => artifactBounds(item.vertices));
    const overlaps = furnishings.some(item => added.some(panel =>
      [0,1,2].every(axis => Math.min(item.max[axis]!,panel.max[axis]!) - Math.max(item.min[axis]!,panel.min[axis]!) > 0.001)));
    if (overlaps) throw invalid();
    return {valid:true,errors:[]};
  } catch {
    return {valid:false,errors:[{code:'PAIRED_WALL_STRUCTURE_INVALID',path:'/candidate/extensions/org.exhibitos.studio~1paired-wall-structure',message:'Expected a supported reciprocal wall pair, clear aperture and inward structural extent.'}]};
  }
}

export function applyPairedWallStructureCommand(scene: Exhibition, command: PairedWallStructureCommand): Exhibition {
  const pairs = [...(settings(scene)?.pairs ?? [])];
  const index = pairs.findIndex(row => same(row.openingId,command.openingId) && same(row.peerOpeningId,command.peerOpeningId));
  if (command.type === 'remove-paired-wall-structure') {
    if (index < 0) throw invalid();
    pairs.splice(index,1);
  } else {
    const {openingId,peerOpeningId,side,extensionMeters} = command;
    const revealFinish = command.revealFinish === undefined ? pairs[index]?.revealFinish : command.revealFinish;
    const extent: PairedWallExtent = {openingId,peerOpeningId,side,extensionMeters,
      ...(revealFinish !== undefined && revealFinish !== null ? {revealFinish} : {})};
    if (index < 0) pairs.push(extent);
    else pairs[index] = extent;
  }
  const extensions: NonNullable<Exhibition['extensions']> = {...scene.extensions};
  if (pairs.length) extensions[PAIRED_WALL_STRUCTURE_NAMESPACE] = {version:1,pairs} as unknown as NonNullable<Exhibition['extensions']>[string];
  else delete extensions[PAIRED_WALL_STRUCTURE_NAMESPACE];
  const next = {...scene,extensions};
  if (!validatePairedWallStructure(next).valid) throw invalid();
  return next;
}

export function remapPairedWallStructure(scene: Pick<Exhibition,'extensions'>, ids: ReadonlyMap<string,string>) {
  const value = settings(scene);
  if (!value) return;
  return {version:1 as const,pairs:value.pairs.map(row => {
    const openingId = ids.get(row.openingId.toLowerCase()), peerOpeningId = ids.get(row.peerOpeningId.toLowerCase());
    if (!openingId || !peerOpeningId) throw invalid();
    return {...row,openingId,peerOpeningId};
  })};
}
