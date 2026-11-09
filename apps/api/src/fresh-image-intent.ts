// SPDX-License-Identifier: AGPL-3.0-or-later
import {ApiError} from './api-error.ts';
import {FRESH_IMAGE_PROFILE} from './product-image-preparation.ts';

export interface FreshImageIntent {
 version:1;
 profile:typeof FRESH_IMAGE_PROFILE;
 artworkRevision:number;
}

export const FRESH_IMAGE_INTENT_SCHEMA={
 type:'object',
 additionalProperties:false,
 required:['version','profile','artworkRevision'],
 properties:{
  version:{const:1},
  profile:{const:FRESH_IMAGE_PROFILE},
  artworkRevision:{type:'integer',minimum:1,maximum:2147483646},
 },
};

export function freshImageIntent(value:unknown):FreshImageIntent {
 const intent=value as Partial<FreshImageIntent>|null;
 if(!intent||typeof intent!=='object'||Object.keys(intent).sort().join(',')!=='artworkRevision,profile,version'||
    intent.version!==1||intent.profile!==FRESH_IMAGE_PROFILE||typeof intent.artworkRevision!=='number'||
    !Number.isSafeInteger(intent.artworkRevision)||intent.artworkRevision<1||intent.artworkRevision>2147483646) {
  throw new ApiError(400,'IMAGE_PREPARATION_INTENT_INVALID');
 }
 return {version:intent.version,profile:intent.profile,artworkRevision:intent.artworkRevision};
}
