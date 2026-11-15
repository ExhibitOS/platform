// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import type {ResolvedViewerBudgetPolicy,ViewerBudgetLimits,ViewerBudgetProfile,ViewerBudgetUsage} from './viewer-budget-policy.js';
/** Server supplies bytes only after ownership, display rights and exact source
 * digest/size validation. A reference is never itself a read permission. */
export type ViewerBudgetAssetReference={kind:'artwork'|'furnishing';artworkId?:string;artworkRevision?:number;assetId?:string;furnishingId?:string;furnishingVersion?:number;sha256:string;bytes:number;mime:string};
export type ViewerBudgetGeometryInput={candidate:Exhibition;profile:ViewerBudgetProfile;loadVerifiedAsset:(reference:ViewerBudgetAssetReference)=>Promise<Uint8Array>;recommendedBaseline?:Partial<ViewerBudgetLimits>;resolvedPolicy?:ResolvedViewerBudgetPolicy;selectionBudget?:{maxTriangles:number;maxTextureSize:number}};
export type ViewerBudgetGeometryResult={accountingVersion:1;profile:ViewerBudgetProfile;wholeExhibition:ViewerBudgetUsage;analyzedSections:ViewerBudgetUsage[];assumptions:string[]};
export type ViewerBudgetGeometryAnalyzer=(input:ViewerBudgetGeometryInput)=>Promise<ViewerBudgetGeometryResult>;
