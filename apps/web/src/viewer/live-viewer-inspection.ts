// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';
import { artifactPoint } from '@exhibitos/studio-contract';
import type { Vec3 } from './navigation';

type Refusal = 'invalid-request' | 'eye-outside-room' | 'standing-unavailable';

export type LivePose = {
  roomId: string;
  eye: Vec3;
  target: Vec3;
  fov: number;
};

const vector = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 &&
  Array.from(value).every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate) && Math.abs(coordinate) <= 10000);

export function qualifyLiveViewerPose(
  exhibition: Exhibition,
  request: unknown,
  currentFov: number,
  qualifiedStandingEye: (eye: Vec3) => Vec3 | undefined,
): { pose: LivePose } | { reason: Refusal } {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { reason: 'invalid-request' };
  const { roomId, eye, lookAt, fov = currentFov } =
    request as { roomId?: unknown; eye?: unknown; lookAt?: unknown; fov?: unknown };
  if (Object.keys(request).some(key => !['roomId', 'eye', 'lookAt', 'fov'].includes(key)) ||
      typeof roomId !== 'string' || !vector(eye) || !vector(lookAt) ||
      typeof fov !== 'number' || !Number.isFinite(fov) || fov < 10 || fov > 120) {
    return { reason: 'invalid-request' };
  }
  const room = exhibition.rooms.find(item => item.id.toLowerCase() === roomId.toLowerCase());
  if (!room) return { reason: 'invalid-request' };
  const { width, height, depth } = room.dimensions;
  if (Math.abs(eye[0]) > width / 2 || eye[1] < 0 || eye[1] > height || Math.abs(eye[2]) > depth / 2) {
    return { reason: 'eye-outside-room' };
  }
  const worldEye = artifactPoint(eye, room.transform), target = artifactPoint(lookAt, room.transform);
  if (Math.hypot(target[0] - worldEye[0], target[2] - worldEye[2]) < .001) return { reason: 'invalid-request' };
  const standing = qualifiedStandingEye(worldEye);
  // Allow the controller's standing skin, without admitting a camera floating
  // above the floor or silently placing it somewhere else.
  if (!standing || Math.hypot(...standing.map((coordinate, i) => coordinate - worldEye[i]!)) > .025) {
    return { reason: 'standing-unavailable' };
  }
  return { pose: { roomId: room.id, eye: worldEye, target, fov } };
}


type PoseDependencies = {
  canvas: HTMLCanvasElement;
  publication: Exhibition;
  currentFov: () => number;
  qualifiedStandingEye: (eye: Vec3) => Vec3 | undefined;
  enter: () => ((resumeInput: boolean) => void) | undefined;
  draw: (pose: LivePose) => boolean;
  read: (pose: LivePose) => object;
};

/** This is installed only by the explicit loopback Viewer development entry. */
export function installLiveViewerInspection({
  canvas, publication, currentFov, qualifiedStandingEye, enter, draw, read,
}: PoseDependencies) {
  let restore: ((resumeInput: boolean) => void) | undefined;
  let active: LivePose | undefined;
  function stop(resumeInput = true) {
    const callback = restore;
    restore = undefined;
    active = undefined;
    callback?.(resumeInput);
  }
  function inspect(request: unknown) {
    const checked = qualifyLiveViewerPose(publication, request, currentFov(), qualifiedStandingEye);
    if ('reason' in checked) return { status: 'rejected' as const, reason: checked.reason };
    if (!restore) restore = enter();
    if (!restore) return { status: 'rejected' as const, reason: 'viewer-unavailable' };
    const pose = checked.pose;
    try {
      if (draw(pose)) {
        active = pose;
        return {
          status: 'applied' as const,
          observation: read(pose),
          read: () => active === pose ? read(pose) : undefined,
          exit: () => { if (active === pose) stop(); },
        };
      }
    } catch (error) {
      stop();
      throw error;
    }
    stop();
    return { status: 'rejected' as const, reason: 'viewer-unavailable' };
  }
  const target = canvas as HTMLCanvasElement & { exhibitosInspectPose?: typeof inspect };
  target.exhibitosInspectPose = inspect;
  return () => {
    if (target.exhibitosInspectPose === inspect) delete target.exhibitosInspectPose;
    stop(false);
  };
}
