// SPDX-License-Identifier: AGPL-3.0-or-later
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
/** The verified publication descriptor binds auxiliary maps to the existing
 * content-addressed public resource channel. Color remains the material asset. */
export function publicResourcesFor(exhibition){
 const resources=new Map();
 const add=item=>{const prior=resources.get(item.sha256);if(prior&&(prior.bytes!==item.bytes||prior.mime!==item.mime))throw Error('PUBLIC_RESOURCE_COLLISION');if(!prior)resources.set(item.sha256,item);};
 for(const item of footstepResourcesFor(exhibition))add(item);
 const materials=exhibition?.extensions?.['org.exhibitos.studio/workspace-materials']?.materials??[];
 if(!Array.isArray(materials)||materials.length>64)throw Error('PUBLIC_MATERIAL_RESOURCES');
 for(const material of materials){if(!material?.maps||material.maps.ao!==undefined)throw Error('PUBLIC_MATERIAL_RESOURCES');for(const role of ['normal','roughness']){const map=material.maps[role];if(!map)continue;if(map.mime!=='image/png'||!Number.isSafeInteger(map.bytes)||map.bytes<1||map.bytes>8388608||! /^[a-f0-9]{64}$/.test(map.sha256))throw Error('PUBLIC_MATERIAL_RESOURCES');add({sha256:map.sha256,bytes:map.bytes,mime:map.mime,artifactPath:`workspace-materials/${material.id}/${material.version}/${role}-${map.sha256}.png`});}}
 return [...resources.values()];
}
