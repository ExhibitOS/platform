// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PreparedImage} from './prepared-image.ts';
import type {PrivatePaintingProfile,PrivatePaintingColour} from './demo-display-policy.ts';

/** Server-owned, reviewed evidence only. No production pre-admissions exist.
 * Receipt digest binds the complete reviewed Manager receipt, including any
 * optional encoding provenance; client declarations never create entries. */
export type PrivatePaintingImportApproval=Readonly<{
 tenantId:string;artworkId:string;revision:number;rights:unknown;
 originalSha256:string;originalBytes:number;prepared:PreparedImage;
 profile:PrivatePaintingProfile;colour:PrivatePaintingColour;receiptSha256:string;
 pngEncoding?:Readonly<{algorithm:'png-rgb8-adaptive-zlib-v1';version:1;tool:'zlib';toolVersion:string;beforeRGB8SHA256:string;afterRGB8SHA256:string}>;
}>;
export const APPROVED_PRIVATE_PAINTING_IMPORTS:readonly PrivatePaintingImportApproval[]=Object.freeze([]);
