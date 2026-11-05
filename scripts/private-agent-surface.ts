// SPDX-License-Identifier: AGPL-3.0-or-later
import {checkedFrame, nativeGeometryAction} from '../apps/web/src/native-viewport-protocol';
import type {NativeGeometryAction, NativeViewportFrame} from '../apps/web/src/native-viewport-protocol';
import {validateDraft} from '../apps/web/src/drafts/validator';

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);

/** A proposal only: the native issuer owns policy, preview validation and CAS. */
export function surfaceTextureProposal(inputFrame: NativeViewportFrame, input: unknown) {
  const frame = checkedFrame(inputFrame);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('SURFACE_PROPOSAL_INVALID');
  const request = input as Record<string, unknown>;
  if (Object.keys(request).sort().join(',') !== 'epoch,material,principalId,requestId,sequence,surfaceId,tenantId,texture,type,version' ||
      request.version !== 1 || request.type !== 'set-material-texture' || !uuid(request.requestId) ||
      request.epoch !== frame.epoch || request.sequence !== frame.sequence || request.tenantId !== frame.tenantId || request.principalId !== frame.principalId ||
      !uuid(request.surfaceId) || frame.disabled || frame.selection?.kind !== 'surface' || frame.selection.id !== request.surfaceId) throw Error('SURFACE_PROPOSAL_STALE');
  const action = {type: request.type, surfaceId: request.surfaceId, material: request.material, texture: request.texture} as NativeGeometryAction;
  const candidate = nativeGeometryAction(frame, action);
  if (!validateDraft({...frame.draft, candidate}).valid) throw Error('SURFACE_PROPOSAL_INVALID');
  return {version: 1, epoch: frame.epoch, sequence: frame.sequence, tenantId: frame.tenantId, principalId: frame.principalId, requestId: request.requestId, surfaceId: request.surfaceId, candidate};
}
