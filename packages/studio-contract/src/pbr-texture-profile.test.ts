// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ordinaryPngRoleSet,pbrTextureBinding, pbrTextureIsLinear } from './pbr-texture-profile.js';
describe('bounded standard PBR texture-info contract', () => {
  it('retains zero normal and AO strength and accepts the agreed endpoints', () => {
    expect(pbrTextureBinding({ index: 0, scale: 0 }, 'normal', 1).scale).toBe(0);
    expect(pbrTextureBinding({ index: 0, scale: 2 }, 'normal', 1).scale).toBe(2);
    expect(pbrTextureBinding({ index: 0, strength: 0 }, 'occlusion', 1).strength).toBe(0);
    expect(pbrTextureBinding({ index: 0, strength: 1 }, 'occlusion', 1).strength).toBe(1);
  });
  it('uses the legacy glTF default only when the parameter is absent', () => {
    expect(pbrTextureBinding({ index: 0 }, 'normal', 1).scale).toBe(1);
    expect(pbrTextureBinding({ index: 0 }, 'occlusion', 1).strength).toBe(1);
  });
  it('rejects values outside the agreed profile instead of clamping them', () => {
    for (const scale of [-1, 2.01, Infinity, NaN, '1', undefined, null])
      expect(() => pbrTextureBinding({ index: 0, scale }, 'normal', 1)).toThrow();
    for (const strength of [-.01, 1.01, Infinity, NaN, '1', undefined, null])
      expect(() => pbrTextureBinding({ index: 0, strength }, 'occlusion', 1)).toThrow();
  });
  it('does not infer data-map roles from the presence of a strength parameter', () => {
    expect(pbrTextureIsLinear('metallicRoughness')).toBe(true);
    expect(pbrTextureIsLinear('normal')).toBe(true);
    expect(pbrTextureIsLinear('occlusion')).toBe(true);
    expect(pbrTextureIsLinear('colour')).toBe(false);
    expect(pbrTextureBinding({ index: 0 }, 'metallicRoughness', 1).role).toBe('metallicRoughness');
  });
  it('rejects unsupported UV sets, references and texture-info keys', () => {
    for (const value of [{ index: 1 }, { index: -1 }, { index: .5 }, { index: '0' },
      { index: 0, texCoord: 1 }, { index: 0, uri: 'https://invalid.example/a.png' },
      { index: 0, extensions: {} }, { index: 0, scale: 1 }])
      expect(() => pbrTextureBinding(value, 'metallicRoughness', 1)).toThrow();
  });
});

const ordinaryRoles=()=>({images:[0,1,2].map(bufferView=>({bufferView,mimeType:'image/png'})),textures:[0,1,2].map(source=>({source})),materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:.1,roughnessFactor:.8},normalTexture:{index:1},occlusionTexture:{index:2}}],meshes:[{primitives:[{material:0}]}]});
it('ordinary three-role resource bound requires distinct fully used image roles, without a provenance marker',()=>{
 expect(ordinaryPngRoleSet(ordinaryRoles())).toBe(true);
 const alias=ordinaryRoles();alias.materials[0]!.normalTexture.index=0;expect(ordinaryPngRoleSet(alias)).toBe(false);
 const shared=ordinaryRoles();shared.textures[2]!.source=1;expect(ordinaryPngRoleSet(shared)).toBe(false);
 const unused=ordinaryRoles();unused.meshes[0]!.primitives[0]!.material=1;expect(ordinaryPngRoleSet(unused)).toBe(false);
 const jpeg=ordinaryRoles();jpeg.images[0]!.mimeType='image/jpeg';expect(ordinaryPngRoleSet(jpeg)).toBe(false);
 expect(ordinaryPngRoleSet({...ordinaryRoles(),images:[...ordinaryRoles().images,{bufferView:3,mimeType:'image/png'}]})).toBe(false);
 expect(ordinaryPngRoleSet({images:[],authority:'Processing'})).toBe(false);
});
