// SPDX-License-Identifier: AGPL-3.0-or-later
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import type {PublicPublication} from '../publication-client';

/** The server may name only the exact resources selected by the verified snapshot. */
export function validFootstepPublication(value:PublicPublication){
 let expected;try{expected=footstepResourcesFor(value.exhibition);}catch{return false;}
 if(!expected.length)return value.resources===undefined;
 if(!Array.isArray(value.resources)||value.resources.length!==expected.length)return false;
 const actual=new Map(value.resources.map(resource=>[resource.sha256,resource]));
 if(actual.size!==expected.length)return false;
 return expected.every(item=>{
  const resource=actual.get(item.sha256);
  return !!resource&&Object.keys(resource).sort().join(',')==='bytes,mime,sha256,url'&&resource.bytes===item.bytes&&resource.mime===item.mime&&resource.url===`/api/v1/publications/${value.publication.id}/resources/${item.sha256}`;
 });
}
