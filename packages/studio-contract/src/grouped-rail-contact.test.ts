// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import type {WorkspaceFurnishingDescriptor} from './workspace-furnishing.js';
import {groupedRailContact,GROUPED_RAIL_CONTACT_QUADS} from './grouped-rail-contact.js';
function descriptor(){const model={mime:'model/gltf-binary',sha256:'5cc5d772acd4087c5d7d26b5f24e2fe38626b1315e377210410954abf7d4ff44',bytes:377576};return {model,fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'passive-ceiling-rail-v1',min:[-3.2175,-.035,-2.698],max:[2.648545,0,2.548]}}} as WorkspaceFurnishingDescriptor;}
it('requires each full adapter footprint on one of nine certified coplanar regions',()=>{
 expect(GROUPED_RAIL_CONTACT_QUADS).toHaveLength(9);
 for(const quad of GROUPED_RAIL_CONTACT_QUADS){const corners=quad.map(([x,z])=>[x,-.035,z] as [number,number,number]);expect(groupedRailContact(descriptor(),corners)).toBe(true);
  expect(groupedRailContact(descriptor(),corners.map(([x,y,z])=>[x,y+.001,z]))).toBe(false);
  expect(groupedRailContact(descriptor(),corners.map(([x,y,z])=>[x+.01,y,z]))).toBe(false);
 }
 expect(groupedRailContact(descriptor(),[[-.0475,-.035,-.019],[.0475,-.035,-.019],[.0475,-.035,.019],[-.0475,-.035,.019]])).toBe(false);
});
it('binds the physical profile to measured source bytes without granting unrelated source admission',()=>{
 const source=descriptor(),corners=GROUPED_RAIL_CONTACT_QUADS[0]!.map(([x,z])=>[x,-.035,z] as [number,number,number]);
 source.model.bytes++;expect(groupedRailContact(source,corners)).toBe(false);source.model.bytes--;
 source.fit!.geometry={profile:'passive-ceiling-rail-v1',min:[-4,-.035,-4],max:[4,0,4]};expect(groupedRailContact(source,corners)).toBe(false);
 source.model.sha256='a'.repeat(64);expect(groupedRailContact(source,corners)).toBeUndefined();
});
