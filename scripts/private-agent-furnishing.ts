// SPDX-License-Identifier: AGPL-3.0-or-later
import {checkedFrame} from '../apps/web/src/native-viewport-protocol';
import {nativeFurnishingVisualsCandidate} from '../apps/web/src/native-furnishing-visuals';

/** Proposal only; native owns authenticated catalog, review and document CAS. */
export function sharedFurnishingProposal(inputFrame: unknown, input: unknown) {
 const frame=checkedFrame(inputFrame);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FURNISHING_REQUEST_INVALID');
 const request=input as Record<string,unknown>;
 if(request.type!=='set-furnishing-visual'||request.hostKind!=='bench'||!['backless-oak-bench','sculpture-bench-refined'].includes(String(request.catalogId))||request.catalogVersion!==1)throw Error('FURNISHING_REQUEST_INVALID');
 const candidate=nativeFurnishingVisualsCandidate(frame,request);
 return {version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:request.requestId,candidate};
}
