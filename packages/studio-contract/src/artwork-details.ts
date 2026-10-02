// SPDX-License-Identifier: AGPL-3.0-or-later
export const ARTWORK_DETAILS_NAMESPACE='org.exhibitos.artwork/details';
export interface ArtworkDetails {version:1;creationYear:number}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateArtworkDetails(artwork:unknown){
  const errors:{code:string;path:string;message:string}[]=[];
  if(!object(artwork)||!object(artwork.extensions)||!Object.hasOwn(artwork.extensions,ARTWORK_DETAILS_NAMESPACE))return {valid:true,errors};
  const value=artwork.extensions[ARTWORK_DETAILS_NAMESPACE];
  if(!object(value)||Object.keys(value).length!==2||value.version!==1||!Number.isSafeInteger(value.creationYear)||Number(value.creationYear)<1||Number(value.creationYear)>9999)errors.push({code:'ARTWORK_DETAILS_INVALID',path:'/extensions/org.exhibitos.artwork~1details',message:'Expected details version1 with an authored integer creationYear from1 through9999'});
  return {valid:errors.length===0,errors};
}
/** Authored year only. Never infer it from import/approval/publication timestamps. */
export function creationYearFor(artwork:{extensions?:unknown}):number|undefined{
  if(!validateArtworkDetails(artwork).valid)return undefined;
  const value=object(artwork.extensions)?artwork.extensions[ARTWORK_DETAILS_NAMESPACE]:undefined;
  return object(value)?value.creationYear as number:undefined;
}
