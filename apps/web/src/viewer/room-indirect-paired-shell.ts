// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  materialFor, pairedWallStructuralSpan, surfaceTextureFor, wallFinishesFor,
  PAIRED_WALL_STRUCTURE_NAMESPACE, WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishings,
} from '@exhibitos/studio-contract';
import * as three from 'three';
import { installArchitecturalFinishes } from '../architectural-finishes-renderer';
import { coincidentPortalSpans, pairedOpeningRevealCoverage } from '../wall-opening-shell';
import { openRoomIndirectPortal, type VerifiedPortalSource } from './room-indirect-portal';

type Vector = [number, number, number];
const epsilon = 1e-5;
const inwardSampleOffset = .05;

/** Qualify the exposed component only. The open aperture is an escape from
 * this component; no geometry or light from either room is inferred. */
export async function openRoomIndirectPairedShell(source: VerifiedPortalSource, openingId: string) {
  const { exhibition } = source;
  const workspace = exhibition.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings | undefined;
  const opening = exhibition.openings.find(row => row.id === openingId);
  const mate = exhibition.openings.find(row => row.id === opening?.connectsToOpeningId);
  if (!opening || !mate || mate.connectsToOpeningId !== opening.id || opening.surfaceId === mate.surfaceId ||
      !workspace?.openingAttachments?.some(row => row.openingId === opening.id) ||
      workspace.openingAttachments.some(row => row.openingId === mate.id) ||
      exhibition.extensions?.[PAIRED_WALL_STRUCTURE_NAMESPACE] ||
      exhibition.extensions?.['org.exhibitos.studio/workspace-materials']) return;
  const wallIds = [opening.surfaceId, mate.surfaceId];
  const finishes = wallFinishesFor(exhibition);
  if (finishes.length !== 2 || !wallIds.every(id => finishes.some(row => row.surfaceId === id)) ||
      finishes.some(row => row.preset !== 'plain' && row.preset !== 'painted-edge')) return;

  const parents = new Map<string, three.Group>();
  const bases = new Map<string, three.MeshStandardMaterial>();
  let shell: ReturnType<typeof installArchitecturalFinishes> | undefined;
  let portal: Awaited<ReturnType<typeof openRoomIndirectPortal>>;
  const dispose = () => {
    portal?.dispose();
    shell?.dispose();
    for (const material of bases.values()) material.dispose();
  };
  try {
    const root = new three.Group();
    for (const id of wallIds) {
      const wall = exhibition.surfaces.find(row => row.id === id);
      const room = exhibition.rooms.find(row => row.id === wall?.roomId);
      const material = materialFor(exhibition, id);
      if (!wall || !room || ![wall,room].every(row=>row.transform.scale.every(value=>value===1)) ||
          material.metalness !== 0 || surfaceTextureFor(exhibition, id))
        throw Error('ROOM_INDIRECT_PAIRED_MATERIAL');
      const roomGroup = new three.Group(), wallGroup = new three.Group();
      roomGroup.position.fromArray(room.transform.position);
      roomGroup.quaternion.fromArray(room.transform.rotation);
      roomGroup.add(wallGroup);
      root.add(roomGroup);
      wallGroup.position.fromArray(wall.transform.position);
      wallGroup.quaternion.fromArray(wall.transform.rotation);
      parents.set(id, wallGroup);
      bases.set(id, new three.MeshStandardMaterial({ ...material, side: three.DoubleSide }));
    }
    const coverage = pairedOpeningRevealCoverage(three, exhibition, parents, finishes);
    const spans = coincidentPortalSpans(exhibition, coverage);
    if (!wallIds.every(id => spans.has(id) && coverage.get(id)?.length === 1))
      throw Error('ROOM_INDIRECT_PAIRED_GEOMETRY');
    const revealOwners = wallIds.filter(id=>coverage.get(id)?.[0]?.omit===false);
    if (revealOwners.length !== 1) throw Error('ROOM_INDIRECT_PAIRED_GEOMETRY');
    shell = installArchitecturalFinishes(three, exhibition, parents, bases);
    portal = await openRoomIndirectPortal(source, openingId);
    if (!portal) throw Error('ROOM_INDIRECT_PAIRED_PORTAL');
    const portalTrace = portal.trace;
    const hostWallId = opening.surfaceId;
    root.updateMatrixWorld(true);
    const ray = new three.Raycaster();
    const normalMatrix = new three.Matrix3(), instanceWorld = new three.Matrix4();
    const copyInstance = new three.Matrix4();
    const meshes = shell.meshes;

    function trace(origin: Vector, direction: Vector, limit: number) {
      ray.ray.origin.fromArray(origin);
      ray.ray.direction.fromArray(direction).normalize();
      ray.near = epsilon;
      ray.far = limit;
      const hit = ray.intersectObjects(meshes, false)[0];
      const trim = portalTrace(origin, direction, hit?.distance ?? limit);
      if (trim && (!hit || trim.distance < hit.distance))
        return { ...trim, surfaceId: hostWallId, kind: 'portal' as const };
      if (!hit?.face || !(hit.object instanceof three.Mesh)) return;
      const mesh = hit.object;
      const material = Array.isArray(mesh.material) ? mesh.material[hit.face.materialIndex] : mesh.material;
      if (!(material instanceof three.MeshStandardMaterial) || material.metalness !== 0)
        throw Error('ROOM_INDIRECT_PAIRED_MATERIAL');
      instanceWorld.copy(mesh.matrixWorld);
      if (mesh instanceof three.InstancedMesh && hit.instanceId !== undefined) {
        mesh.getMatrixAt(hit.instanceId, copyInstance);
        instanceWorld.multiply(copyInstance);
      }
      const normal = hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(instanceWorld));
      if (normal.dot(ray.ray.direction) > 0) normal.negate();
      const {r,g,b} = material.color;
      const face = mesh.userData.architecturalFinish as {surfaceId:string;kind:'structure'|'finish'};
      return {
        ...face, distance:hit.distance, position:hit.point.toArray(), normal:normal.toArray(),
        reflectance:[r,g,b] as Vector,
      };
    }

    return {
      wallIds,
      revealSurfaceId: revealOwners[0]!,
      trace,
      /** A wall chart starts at the visible inward face, never the center
       * plane. Apertures and portal-covered samples have no wall receiver. */
      receiverOrigin(surfaceId: string, x: number, y: number) {
        const wall = parents.get(surfaceId);
        const finish = finishes.find(row => row.surfaceId === surfaceId);
        if (!wall || !finish) return;
        const front = pairedWallStructuralSpan(exhibition, surfaceId, finish.depth).maxZ;
        const normal = new three.Vector3(0,0,1).transformDirection(wall.matrixWorld);
        const start = wall.localToWorld(new three.Vector3(x,y,front + inwardSampleOffset));
        const hit = trace(start.toArray(), normal.clone().negate().toArray(), inwardSampleOffset + epsilon);
        if (!hit || hit.surfaceId !== surfaceId || hit.kind === 'portal' ||
            normal.dot(new three.Vector3(...hit.normal)) < 1 - epsilon) return;
        return { ...hit, position: new three.Vector3(...hit.position).addScaledVector(normal, epsilon).toArray() };
      },
      dispose,
    };
  } catch {
    dispose();
    return;
  }
}
