// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {materialFor,validateStudioMaterials,MATERIAL_NAMESPACE,type StudioMaterials} from './index.js';
import {surfaceTextureDefaults,surfaceTextureMaterialMap,surfaceTextureFor,remapStudioMaterials,type SurfaceMaterialTextureCommand} from './surface-textures.js';
const id='aaaaaaaa-0000-4000-8000-000000000001',other='aaaaaaaa-0000-4000-8000-000000000002';
const fixture=()=>({surfaces:[{id,type:'wall'},{id:other,type:'ceiling'}],extensions:{'org.example/opaque':{text:id}}}) as unknown as Exhibition;
const command=():SurfaceMaterialTextureCommand=>({type:'set-material-texture',surfaceId:id,material:null,texture:surfaceTextureDefaults('museum-matte-paint').texture});
function apply(e:Exhibition,c=command()){return {...structuredClone(e),extensions:{...e.extensions,[MATERIAL_NAMESPACE]:surfaceTextureMaterialMap(e,c) as unknown as NonNullable<Exhibition['extensions']>[string]}};}
test('two actual physical repeats and map scalars survive JSON save/reopen without unrelated metadata',()=>{
 const e=fixture(),before=structuredClone(e),paint=apply(e),plaster=apply(paint,{...command(),surfaceId:other,texture:surfaceTextureDefaults('fine-lime-plaster').texture});
 expect(e).toEqual(before);expect(validateStudioMaterials(plaster).valid).toBe(true);
 const reopened=JSON.parse(JSON.stringify(plaster));expect(surfaceTextureFor(reopened,id)?.repeatMeters).toEqual([1,1]);expect(surfaceTextureFor(reopened,other)?.repeatMeters).toEqual([2,2]);
 expect(materialFor(reopened,id)).toEqual({color:'#ffffff',roughness:1,metalness:0});expect(materialFor(fixture(),id)).toEqual({color:'#f4f1e8',roughness:.8,metalness:0});
 expect(Object.keys(reopened).sort()).toEqual(['extensions','surfaces']);expect(reopened.extensions['org.example/opaque']).toEqual(e.extensions!['org.example/opaque']);
 expect(JSON.stringify(reopened)).not.toMatch(/height|ambientOcclusion|mediaAssets|displacement|file:\/\//);
});
test('clear removes only the selected texture and scalar, preserving advanced values elsewhere and legacy namespace shape',()=>{
 const first=apply(fixture()),both=apply(first,{...command(),surfaceId:other,material:{color:'#aabbcc',roughness:.37,metalness:0},texture:{...surfaceTextureDefaults('fine-lime-plaster').texture,rotation:.7,normalScale:.6}}),before=structuredClone(both);
 const cleared=apply(both,{...command(),texture:null});expect(surfaceTextureFor(cleared,id)).toBeUndefined();expect(surfaceTextureFor(cleared,other)).toEqual(surfaceTextureFor(before,other));expect(materialFor(cleared,other)).toEqual(materialFor(before,other));
 const last=apply(cleared,{...command(),surfaceId:other,texture:null});expect(last.extensions![MATERIAL_NAMESPACE]).toEqual({version:1,surfaces:{}});expect(both).toEqual(before);
});
test('unknown roles, paths, versions, floor targets, nonfinite or out-of-budget settings reject before mutation',()=>{
 for(const patch of [{pack:{id:'unknown',version:1}},{pack:{id:'museum-matte-paint',version:2}},{repeatMeters:[0,1]},{rotation:NaN},{normalScale:3},{height:1},{url:'https://example.test/map.png'}]){const e=fixture(),c=command();c.texture={...c.texture,...patch} as never;expect(()=>surfaceTextureMaterialMap(e,c)).toThrow();expect(e.extensions![MATERIAL_NAMESPACE]).toBeUndefined();}
 const e=fixture();e.surfaces[0]!.type='floor';expect(()=>apply(e)).toThrow('SURFACE_TEXTURE_REFERENCE');
 const malformed=apply(fixture());malformed.surfaces[0]!.type=['wall'] as never;expect(validateStudioMaterials(malformed).valid).toBe(false);
 const valid=apply(fixture()),map=valid.extensions![MATERIAL_NAMESPACE] as unknown as StudioMaterials;map.surfaceTextures![id.toUpperCase()]=structuredClone(map.surfaceTextures![id]!);expect(validateStudioMaterials(valid).valid).toBe(false);
});
test('OEX forks remap both typed surface maps while preserving catalogue identity, settings and optional empty maps',()=>{
 const e=apply(fixture(),{...command(),material:{color:'#aabbcc',roughness:.4,metalness:.1}}),map=e.extensions![MATERIAL_NAMESPACE] as unknown as StudioMaterials,before=structuredClone(map),target='bbbbbbbb-0000-4000-8000-000000000001';
 const remapped=remapStudioMaterials(map,new Map([[id.toLowerCase(),target]]));
 expect(remapped.surfaces[target]).toEqual(map.surfaces[id]);expect(remapped.surfaceTextures![target]).toEqual(map.surfaceTextures![id]);expect(remapped.surfaceTextures![id]).toBeUndefined();expect(map).toEqual(before);
 expect(remapStudioMaterials({version:1,surfaces:{},surfaceTextures:{}},new Map())).toEqual({version:1,surfaces:{},surfaceTextures:{}});
});
