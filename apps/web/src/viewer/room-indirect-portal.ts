// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';
import { qualifiedModularPortalTarget, workspaceFitGeometry } from '@exhibitos/spec/workspace-fit-models';
import { validateWorkspaceFurnishings, WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishings } from '@exhibitos/studio-contract';
import * as three from 'three';
import { fitModularPortal } from '../workspace-furnishing/portal-pose';
import { publicWorkspaceFurnishingRights } from '../workspace-furnishing/public-rights.mjs';
import { loadBudgetGeometry } from './viewer-budget-glb';

type Vector = [number, number, number];
type ExportedAsset = { assetId: string; path: string; sha256: string; bytes: number; mime: string };
interface VerifiedPortalSource {
  exhibition: Exhibition;
  assets: readonly ExportedAsset[];
  /** Reads only manifest-verified files from the same local export or stage. */
  read(path: string): Promise<Uint8Array>;
}

function diffuseReflectance(material: unknown): Vector | undefined {
  if (!(material instanceof three.MeshStandardMaterial) || material.type !== 'MeshStandardMaterial' ||
      material.side !== three.DoubleSide || !material.visible ||
      material.transparent || material.opacity !== 1 || material.alphaTest !== 0 || material.alphaHash ||
      material.metalness !== 0 || material.vertexColors || material.emissive.toArray().some(value => value !== 0) ||
      material.wireframe || material.map || material.alphaMap) return;
  const { r, g, b } = material.color;
  const rgb: Vector = [r, g, b];
  if (rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return rgb;
}

/** Resolve only one already exported modular portal. Failure to qualify the
 * component is distinct from a qualified ray missing its trim. */
export async function openRoomIndirectPortal(source: VerifiedPortalSource, openingId: string, space: 'world' | 'room' = 'world') {
  const { exhibition } = source;
  const workspace = exhibition.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings | undefined;
  if (!workspace || !validateWorkspaceFurnishings(exhibition).valid) return;
  const attachment = workspace.openingAttachments?.find(value => value.openingId === openingId);
  const opening = exhibition.openings.find(value => value.id === openingId);
  const wall = exhibition.surfaces.find(value => value.id === opening?.surfaceId);
  const room = exhibition.rooms.find(value => value.id === wall?.roomId);
  if (!attachment || !opening || !wall || !room) return;
  const descriptor = workspace.furnishings.find(value =>
    value.id === attachment.furnishingId && value.version === attachment.furnishingVersion);
  if (!descriptor || !publicWorkspaceFurnishingRights({ furnishings: [descriptor] })) return;
  const fit = workspaceFitGeometry(descriptor);
  if (!fit || fit.profile !== 'modular-portal-v1') return;
  const target = qualifiedModularPortalTarget(fit, exhibition, opening.id, descriptor);
  const matching = source.assets.filter(value => value.assetId === descriptor.id);
  const asset = matching[0];
  if (!target || !asset || matching.length !== 1 || asset.sha256 !== descriptor.model.sha256 ||
      asset.bytes !== descriptor.model.bytes || asset.mime !== descriptor.model.mime ||
      asset.path !== `data/${asset.sha256}.bin`) return;

  let loaded: Awaited<ReturnType<typeof loadBudgetGeometry>> | undefined;
  try {
    loaded = await loadBudgetGeometry(await source.read(asset.path), asset, 8 * 1024 * 1024);
    if (loaded.hasTextures) throw Error('ROOM_INDIRECT_PORTAL_MATERIAL');
    const model = loaded.model;
    fitModularPortal(three, model, fit, target);
    const compose = ({position, rotation, scale}: typeof room.transform) => new three.Matrix4().compose(
      new three.Vector3(...position), new three.Quaternion(...rotation), new three.Vector3(...scale),
    );
    if (space === 'world') model.matrix.copy(compose(room.transform));
    model.matrix.multiply(compose(wall.transform))
      .multiply(new three.Matrix4().makeTranslation(opening.offset[0], opening.offset[1] - target.height / 2, 0));
    model.matrixAutoUpdate = false;
    model.updateMatrixWorld(true);
    const reflectance = new Map<three.Object3D, Vector>();
    const parts: { mesh: three.Mesh; bounds: three.Box3; triangles: number }[] = [];
    for (const child of model.children) {
      if (!(child instanceof three.Mesh)) throw Error('ROOM_INDIRECT_PORTAL_GEOMETRY');
      const rgb = diffuseReflectance(child.material);
      if (!rgb) throw Error('ROOM_INDIRECT_PORTAL_MATERIAL');
      const count = child.geometry.index?.count ?? child.geometry.getAttribute('position').count;
      if (count % 3 !== 0 || child.geometry.groups.length) throw Error('ROOM_INDIRECT_PORTAL_GEOMETRY');
      child.geometry.computeBoundingBox();
      parts.push({ mesh: child, bounds: new three.Box3().setFromObject(child), triangles: count / 3 });
      reflectance.set(child, rgb);
    }
    const ray = new three.Raycaster();
    const normalMatrix = new three.Matrix3();
    return {
      source: { openingId, roomId: room.id, furnishingId: descriptor.id, furnishingVersion: descriptor.version, sha256: asset.sha256 },
      /** Segment in the chosen coordinate space. Dir is normalized before applying the metre limit. */
      trace(origin: Vector, dir: Vector, limit: number, charge?: (tests: number) => void) {
        if (!publicWorkspaceFurnishingRights({ furnishings: [descriptor] })) throw Error('ROOM_INDIRECT_PORTAL_RIGHTS');
        ray.ray.origin.fromArray(origin);
        ray.ray.direction.fromArray(dir).normalize();
        ray.near = 1e-5;
        ray.far = limit;
        const candidates = parts.filter(part => ray.ray.intersectsBox(part.bounds));
        charge?.(parts.length + candidates.reduce((sum, part) => sum + part.triangles, 0));
        const hit = ray.intersectObjects(candidates.map(part => part.mesh), false)[0];
        if (!hit?.face) return;
        const normal = hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
        if (normal.dot(ray.ray.direction) > 0) normal.negate();
        return {
          distance: hit.distance, position: hit.point.toArray(), normal: normal.toArray(),
          reflectance: reflectance.get(hit.object)!,
        };
      },
      dispose: loaded.dispose,
    };
  } catch {
    loaded?.dispose();
    return;
  }
}
