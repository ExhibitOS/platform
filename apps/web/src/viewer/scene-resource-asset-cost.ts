// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {existingSceneCost} from '../workspace-furnishing/scene-cost';
import {geometryResidentBytes} from './loading';

export type SceneResourceAssetCost={accountingVersion:1;sha256:string;bytes:number;sourceProfile:string;colorDraws:number;displayTriangles:number;geometryBytes:number};
/** Internal producer boundary, callable in browser or Node. The caller MUST pass
 * the model from the verified loader AFTER its actual admitted transformation
 * (including fixture batching), never a metadata-only or fallback stand-in.
 * The resulting receipt is a source/profile contribution, not a whole scene,
 * material/texture estimate, shadow cost or untrusted client attestation. */
export async function sceneResourceAssetCost(three:typeof Three,admittedModel:Three.Object3D,source:{sha256:string;bytes:number;sourceProfile:string},verifiedBytes:Uint8Array):Promise<SceneResourceAssetCost>{
 if(!/^[a-f0-9]{64}$/.test(source.sha256)||!Number.isSafeInteger(source.bytes)||source.bytes<1||source.bytes!==verifiedBytes.byteLength||!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(source.sourceProfile))throw Error('SCENE_RESOURCE_ASSET_IDENTITY');
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(verifiedBytes)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(digest!==source.sha256)throw Error('SCENE_RESOURCE_ASSET_IDENTITY');
 const attributes:(Three.BufferAttribute|Three.InterleavedBufferAttribute)[]=[];
 admittedModel.traverse(node=>{
  if(!(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points))return;
  const geometry:Three.BufferGeometry=node.geometry;
  attributes.push(...Object.values(geometry.attributes));
  for(const values of Object.values(geometry.morphAttributes))if(values)attributes.push(...values);
  if(node.geometry.index)attributes.push(node.geometry.index);
  if(node instanceof three.InstancedMesh){attributes.push(node.instanceMatrix);if(node.instanceColor)attributes.push(node.instanceColor);}
 });
 const cost=existingSceneCost(three,admittedModel);
 return {accountingVersion:1,...source,colorDraws:cost.draws,displayTriangles:cost.triangles,geometryBytes:geometryResidentBytes(attributes)};
}
