// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {BUDGET_GEOMETRY_PAIR_PROFILE,LOD_NAMESPACE,NEAR_GEOMETRY_PAIR_PROFILE,validateViewerLod} from './viewer.js';
const full='11111111-1111-4111-8111-111111111111',coarse='22222222-2222-4222-8222-222222222222';
function artwork(){return {artworkType:'sculpture',primaryAssetId:full,assets:[{id:full,mime:'model/gltf-binary',role:'model',bytes:16036864},{id:coarse,mime:'model/gltf-binary',role:'model',bytes:1874704}],extensions:{[LOD_NAMESPACE]:{version:1,profile:BUDGET_GEOMETRY_PAIR_PROFILE,variants:[{assetId:full,detail:'full',triangles:100000,textureSize:2048},{assetId:coarse,detail:'coarse',triangles:20000,textureSize:512}]}}};}
it('declares a distinct budget fallback profile with both measured model metrics',()=>{expect(BUDGET_GEOMETRY_PAIR_PROFILE).not.toBe(NEAR_GEOMETRY_PAIR_PROFILE);expect(validateViewerLod(artwork()).valid).toBe(true);});
it.each(['triangles','textureSize'] as const)('rejects missing coarse %s admission evidence',key=>{const a=artwork();delete (a.extensions[LOD_NAMESPACE].variants[1] as Record<string,unknown>)[key];expect(validateViewerLod(a).valid).toBe(false);});
it('rejects over-budget coarse and non-reducing pairs without widening old near policy',()=>{
 const a=artwork();a.extensions[LOD_NAMESPACE].variants[1]!.triangles=20001;expect(validateViewerLod(a).valid).toBe(false);
 const b=artwork();b.extensions[LOD_NAMESPACE].variants[1]!.textureSize=1024;expect(validateViewerLod(b).valid).toBe(false);
 const c=artwork();c.assets[1]!.bytes=c.assets[0]!.bytes;expect(validateViewerLod(c).valid).toBe(false);
 const d=artwork();d.extensions[LOD_NAMESPACE].profile=NEAR_GEOMETRY_PAIR_PROFILE;d.extensions[LOD_NAMESPACE].variants[0]!.textureSize=512;expect(validateViewerLod(d).valid).toBe(false);
});
