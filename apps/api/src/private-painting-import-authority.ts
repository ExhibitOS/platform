// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {artworkAccess,sha256} from '@exhibitos/storage';
import type {PoolClient} from 'pg';
import {ApiError} from './api-error.ts';
import {allowedRights} from './rights.ts';
import {APPROVED_PRIVATE_PAINTING_IMPORTS,type PrivatePaintingImportApproval} from './approved-private-painting-imports.ts';
import type {PreparedImage} from './prepared-image.ts';

/** Select only from the server list. A request, OEX or receipt cannot add an entry. */
export function privatePaintingImportCandidate(row:Record<string,unknown>,prepared:PreparedImage|undefined){
 if(!prepared||row.mime!=='image/jpeg')return undefined;
 return APPROVED_PRIVATE_PAINTING_IMPORTS.find(a=>a.originalSha256===row.expected_hash&&a.prepared.sha256===prepared.sha256);
}
/** Called in each transaction at validation and before committing the asset. */
export async function checkPrivatePaintingImport(c:PoolClient,row:Record<string,unknown>,approval:PrivatePaintingImportApproval,original:Buffer,prepared:Buffer){
 const fail=():never=>{throw new ApiError(422,'PRIVATE_PAINTING_AUTHORITY_INVALID');};
 if(!APPROVED_PRIVATE_PAINTING_IMPORTS.includes(approval)||row.tenant_id!==approval.tenantId||row.artwork_id!==approval.artworkId||typeof row.user_id!=='string'||row.expected_hash!==approval.originalSha256||Number(row.expected_bytes)!==approval.originalBytes||!isDeepStrictEqual(row.derived,approval.prepared)||!isDeepStrictEqual(row.rights,approval.rights)||!allowedRights(row.rights,'display')||!/^[a-f0-9]{64}$/.test(approval.receiptSha256))fail();
 const colour=approval.colour,recipe=approval.prepared.recipe,encoding=approval.pngEncoding;
 if(encoding&&(!isDeepStrictEqual(Object.keys(encoding).sort(),['afterRGB8SHA256','algorithm','beforeRGB8SHA256','tool','toolVersion','version'].sort())||encoding.algorithm!=='png-rgb8-adaptive-zlib-v1'||encoding.version!==1||encoding.tool!=='zlib'||typeof encoding.toolVersion!=='string'||!/^[ -~]{1,128}$/.test(encoding.toolVersion)||encoding.beforeRGB8SHA256!==recipe.outputPixelsSha256||encoding.afterRGB8SHA256!==recipe.outputPixelsSha256))fail();
 if(colour.kind==='no-profile-srgb-assumed'?(recipe.colourMeaning!=='srgb-assumed'||recipe.colourConversion!==undefined):colour.kind==='icc-to-srgb'?(recipe.colourMeaning!=='srgb'||!isDeepStrictEqual(recipe.colourConversion,{version:colour.version,algorithm:colour.algorithm,sourceIccSha256:colour.sourceIccSha256})):true)fail();
 if(original.length!==approval.originalBytes||sha256(original)!==approval.originalSha256||prepared.length!==approval.prepared.bytes||sha256(prepared)!==approval.prepared.sha256)fail();
 const artwork=await artworkAccess(c,{tenantId:approval.tenantId,userId:row.user_id as string},approval.artworkId,true);
 const locked=await c.query('SELECT revision,metadata FROM artworks WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE',[approval.tenantId,approval.artworkId]);
 const current=locked.rows[0];
 if(!current||artwork.revision!==approval.revision||current.revision!==approval.revision||!isDeepStrictEqual(current.metadata?.rights,approval.rights)||!allowedRights(current.metadata?.rights,'display'))fail();
 return approval;
}
