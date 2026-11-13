// SPDX-License-Identifier: AGPL-3.0-or-later
import type {FurnishingThumbnailPng,FurnishingThumbnailSource,FURNISHING_THUMBNAIL_RECIPE_ID,FURNISHING_THUMBNAIL_TOOL_ID} from './workspace-furnishing-thumbnail-contract.ts';
/** An installed, immutable distribution binding; never a tenant selection. */
export const INSTALLED_FURNISHING_THUMBNAIL_PROFILE='installed-furnishing-thumbnail-v1' as const;
export interface InstalledFurnishingThumbnail {
 profile:typeof INSTALLED_FURNISHING_THUMBNAIL_PROFILE;
 source:FurnishingThumbnailSource;
 png:FurnishingThumbnailPng;
 provenance:{recipeId:typeof FURNISHING_THUMBNAIL_RECIPE_ID;toolId:typeof FURNISHING_THUMBNAIL_TOOL_ID;renderRequestId:string};
}
export interface PackagedFurnishingThumbnail extends InstalledFurnishingThumbnail {path:string}
