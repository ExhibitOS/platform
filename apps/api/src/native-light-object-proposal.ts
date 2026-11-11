// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import type {Exhibition} from '@exhibitos/spec';
import {applyLightObjectCommand,validateFurnishings,type LightObjectCommand} from '@exhibitos/studio-contract';
import type {NativeFixtureScope} from './native-fixture-proposal.ts';

export type {LightObjectCommand};
function scopedId(namespace:string,scope:NativeFixtureScope):string{
 const digest=createHash('sha256').update(JSON.stringify([namespace,scope.workspaceId,scope.tenantId,scope.principalId,scope.exhibitionId,scope.head,scope.epoch,scope.sequence,scope.requestId])).digest('hex');
 return `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
}
/** Authentication, saved-head CAS and complete lifecycle checks stay with Studio.
 * Only this trusted adapter supplies new identities; collisions are never retried. */
export function nativeLightObjectProposal(candidate:Exhibition,command:LightObjectCommand,scope:NativeFixtureScope):{candidate:Exhibition;lightId:string}{
 if(!validateFurnishings(candidate).valid)throw Error('LIGHT_OBJECT_PROPOSAL_INVALID');
 const result=applyLightObjectCommand(candidate,command,{
  newLightId:scopedId('native-light-object-v1',scope),
  newAssetId:scopedId('native-light-object-asset-v1',scope),
  verifiedBaseline:candidate,
 });
 if(!validateFurnishings(result.candidate).valid)throw Error('LIGHT_OBJECT_PROPOSAL_INVALID');
 return result;
}
