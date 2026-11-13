// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {museumWallwasherRearReliefProfile} from '../../../../packages/studio-contract/src/wallwasher-rear-relief-profile.js';
import type {WallwasherFixtureAssetIdentity} from '../../../../packages/studio-contract/src/wallwasher-fixture-profile.js';
import {coupleFixtureEmission} from '../fixture-emission';

const owned=new WeakSet<Three.BufferGeometry>();
function fail():never{throw Error('WALLWASHER_EMITTER_PROFILE_INVALID');}
/** After immutable loader admission and pose validation, designate only the two
 * approved forward panel triangles. Index-unit groups add two draw calls, no
 * geometry/texture buffers or lights. Optics_dark on other parts stays original.
 * Each loader instance must own its panel geometry; release precedes loader disposal. */
export function installWallwasherEmission(three:typeof Three,model:Three.Object3D,asset:WallwasherFixtureAssetIdentity,light:Three.Light){
 museumWallwasherRearReliefProfile(asset);
 const panels:Three.Mesh[]=[];model.traverse(node=>{if(node.userData.name==='Optical_panel'&&node instanceof three.Mesh)panels.push(node);});
 if(panels.length!==1)fail();const panel=panels[0]!,geometry=panel.geometry,index=geometry.index,position=geometry.getAttribute('position'),source=panel.material;
 let uses=0;model.traverse(node=>{if(node instanceof three.Mesh&&node.geometry===geometry)uses++;});
 if(uses!==1||owned.has(geometry)||!index||!(index.array instanceof Uint16Array)||index.count!==564||!position||position.count!==349||position.itemSize!==3||geometry.groups.length||geometry.drawRange.start!==0||geometry.drawRange.count!==Infinity||Array.isArray(source)||!(source instanceof three.MeshStandardMaterial)||!source.visible||source.transparent||source.opacity!==1||source.alphaTest>0||source.alphaHash||!light.isLight)fail();
 const expected=[94,134,310,94,310,263];
 if(expected.some((n,i)=>index.getX(552+i)!==n))fail();
 for(const [i,x,y]of [[94,-.0693,-.0113],[134,-.0693,.0113],[310,.0693,.0113],[263,.0693,-.0113]] as const){
  if(Math.abs(position.getX(i)-x)>1e-7||Math.abs(position.getY(i)-y)>1e-7||Math.abs(position.getZ(i)+.001)>1e-7)fail();
 }
 const emitter=source.clone(),groups=geometry.groups.map(g=>({...g}));let disposed=false;
 owned.add(geometry);geometry.addGroup(0,552,0);geometry.addGroup(552,6,1);geometry.addGroup(558,6,0);panel.material=[source,emitter];
 const release=coupleFixtureEmission(panel,emitter,light);
 return {extraDrawCalls:2,extraGeometryBytes:0,extraTextureBytes:0,dispose(){
  if(disposed)return;disposed=true;release();panel.material=source;geometry.clearGroups();for(const group of groups)geometry.addGroup(group.start,group.count,group.materialIndex);owned.delete(geometry);emitter.dispose();
 }};
}
