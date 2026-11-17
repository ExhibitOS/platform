// SPDX-License-Identifier: AGPL-3.0-or-later
import {sha256} from '@exhibitos/storage';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {allowedRights} from './rights.ts';

// This record is specific to the acquired Met file. It does not approve its
// prepared PNG, a decoder, a device budget, or any other institution's file.
const wheat = {
 approvalId:'ce328328-97fa-56cf-8fc1-6bafd4573153',
 sha256:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',
 bytes:8291194,
 mime:'image/jpeg',
 rightsEvidenceSha256:'ef645d21f8be64f44d3b8027031aa6775f2eba09af3712c827ad6f82431211c6',
 provenanceSha256:'ccd1068239ca0e9bda892ac6781b1d6efc389b4658da2423709110550755cbaf',
} as const;

type GrantInput={approvalId?:string;workspaceId:string;tenantId:string;principalId:string;artworkId:string;artworkRevision:number;artworkRevisionId:string;jobId:string;originalAssetId:string;primaryAssetId:string;sha256:string;bytes:number;mime:string;rights:unknown};

/** Construct only inside the owner-fenced replacement transaction after the
 * job, asset rows, derivative lineage and actual source bytes were checked.
 * The result is private evidence, not a public detail candidate or a token. */
export function originalStaticGrant(input:GrantInput,now=Date.now(),ownerLineage?:{preparation:unknown;coarse:unknown}) {
 const rights=input.rights as {licenseId?:unknown;expiresAt?:unknown}|null;
 if(input.mime!=='image/jpeg'||!rights||rights.licenseId!=='CC0-1.0'||rights.expiresAt!==undefined||!(['display','export','download'] as const).every(p=>allowedRights(rights,p,now)))return undefined;
 const evidence=ownerLineage&&input.approvalId===undefined
  ?{approvalId:input.jobId,source:{sha256:input.sha256,bytes:input.bytes,mime:'image/jpeg' as const},
    rightsEvidenceSha256:sha256(Buffer.from(freezeCanonical(input.rights))),
    rightsEvidenceEncoding:'freeze-canonical-utf8',
    provenanceSha256:sha256(Buffer.from(freezeCanonical(ownerLineage)))}
  :input.approvalId===wheat.approvalId&&input.sha256===wheat.sha256&&input.bytes===wheat.bytes
   ?{approvalId:wheat.approvalId,source:{sha256:wheat.sha256,bytes:wheat.bytes,mime:wheat.mime},
     rightsEvidenceSha256:wheat.rightsEvidenceSha256,rightsEvidenceEncoding:'jq-cS-utf8-lf',provenanceSha256:wheat.provenanceSha256}
   :undefined;
 if(!evidence)return undefined;
 return {version:1,kind:'exact-original-static-grant',workspaceId:input.workspaceId,tenantId:input.tenantId,principalId:input.principalId,artworkId:input.artworkId,artworkRevision:input.artworkRevision,artworkRevisionId:input.artworkRevisionId,jobId:input.jobId,originalAssetId:input.originalAssetId,primaryAssetId:input.primaryAssetId,...evidence,uses:{publicNetwork:true,durableRedistribution:true},rights:structuredClone(input.rights)};
}
