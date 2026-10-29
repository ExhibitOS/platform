// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import type {PublicPublication} from '../publication-client';
import {validFootstepPublication} from './footstep-publication';
const id='11111111-1111-4111-8111-111111111111';
function publication(){
 const exhibition={extensions:{'org.exhibitos.viewer/footstep-resources':{version:1,families:['wood']}}};
 const resources=footstepResourcesFor(exhibition).map(item=>({sha256:item.sha256,bytes:item.bytes,mime:item.mime,url:`/api/v1/publications/${id}/resources/${item.sha256}`}));
 return {publication:{id},exhibition,resources} as unknown as PublicPublication;
}
test('resource declarations bind the complete exact registry and scoped URLs',()=>{
 const value=publication();expect(validFootstepPublication(value)).toBe(true);
 for(const mutate of [
  (v:PublicPublication)=>{v.resources!.pop();},
  (v:PublicPublication)=>{v.resources![0]!.bytes++;},
  (v:PublicPublication)=>{v.resources![0]!.url='/other';},
  (v:PublicPublication)=>{v.resources![0]=v.resources![1]!;},
  (v:PublicPublication)=>{Object.assign(v.resources![0]!,{extra:true});},
 ]){const next=publication();mutate(next);expect(validFootstepPublication(next)).toBe(false);}
});
test('legacy publications do not accept undeclared extra resources',()=>{
 const value=publication();value.exhibition.extensions={};delete value.resources;expect(validFootstepPublication(value)).toBe(true);
 value.resources=[];expect(validFootstepPublication(value)).toBe(false);
});
