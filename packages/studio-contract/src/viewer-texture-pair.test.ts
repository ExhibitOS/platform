// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {LOD_NAMESPACE,NEAR_TEXTURE_PAIR_PROFILE,validateViewerLod,lodVariantsFor} from './viewer.js';
const full='10000000-0000-4000-8000-000000000001',coarse='10000000-0000-4000-8000-000000000002';
function art(){return {artworkType:'sculpture',primaryAssetId:full,assets:[{id:full,mime:'model/gltf-binary',role:'model',bytes:10000},{id:coarse,mime:'model/gltf-binary',role:'model',bytes:1000}],extensions:{[LOD_NAMESPACE]:{version:1,profile:NEAR_TEXTURE_PAIR_PROFILE,variants:[{assetId:full,detail:'full',triangles:150000,textureSize:2048},{assetId:coarse,detail:'coarse',triangles:150000,textureSize:512}]}}};}
test('explicit model profile permits texture-only reduction and retains both actual demand metrics',()=>{const a=art();expect(validateViewerLod(a).valid).toBe(true);expect(lodVariantsFor(a)[1]).toMatchObject({triangles:150000,textureSize:512});});
test('legacy pairs still require geometry reduction; explicit profile cannot change geometry or omit metrics',()=>{
 const a=art();delete (a.extensions[LOD_NAMESPACE] as {profile?:string}).profile;expect(validateViewerLod(a).valid).toBe(false);
 const b=art();b.extensions[LOD_NAMESPACE]!.variants[1]!.triangles=20000;expect(validateViewerLod(b).valid).toBe(false);
 const c=art();delete (c.extensions[LOD_NAMESPACE]!.variants[1] as {textureSize?:number}).textureSize;expect(validateViewerLod(c).valid).toBe(false);
});
