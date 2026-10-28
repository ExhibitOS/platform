// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import type {Artwork} from '@exhibitos/spec';
import {LOD_NAMESPACE,NEAR_TEXTURE_PAIR_PROFILE} from '@exhibitos/studio-contract';
import {selectAssetVariant,selectedDeviceBudget} from './loading';
const full='10000000-0000-4000-8000-000000000001',coarse='10000000-0000-4000-8000-000000000002';
const artwork={artworkType:'sculpture',primaryAssetId:full,assets:[{id:full,mime:'model/gltf-binary',role:'model',bytes:10000},{id:coarse,mime:'model/gltf-binary',role:'model',bytes:1000}],extensions:{[LOD_NAMESPACE]:{version:1,profile:NEAR_TEXTURE_PAIR_PROFILE,variants:[{assetId:full,detail:'full',triangles:150000,textureSize:2048},{assetId:coarse,detail:'coarse',triangles:150000,textureSize:512}]}}} as unknown as Artwork;
test('desktop near and far choose actual texture tiers without discounting either geometry',()=>{
 const budget=selectedDeviceBudget('desktop',{});expect(selectAssetVariant(artwork,1,budget).id).toBe(full);expect(selectAssetVariant(artwork,4,budget).id).toBe(coarse);
 expect(()=>selectAssetVariant(artwork,4,selectedDeviceBudget('compact',{}))).toThrow('ASSET_BUDGET_EXCEEDED');
});
