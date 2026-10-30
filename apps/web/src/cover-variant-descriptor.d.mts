export interface CoverDescriptorImage {assetId:string;mime:'image/png';sha256:string;bytes:number;width:number;height:number}
export interface CoverVariantDescriptor {version:1;revisionSha256:string;primary:CoverDescriptorImage;variants:CoverDescriptorImage[]}
/** Structure and inventory binding only; does not prove image provenance or grant rights. */
export function validateCoverVariantDescriptor(publication:unknown):boolean;
