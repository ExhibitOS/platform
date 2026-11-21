// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateCoverVariantDescriptor} from '../apps/web/src/cover-variant-descriptor.mjs';
import {bindDerivedStaticCover} from './derived-static-cover.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const primary = {assetId:'00000000-0000-4000-8000-000000000002',mime:'image/png',sha256:'1'.repeat(64),width:2048,height:1630,bytes:8103573};
const small = {assetId:'00000000-0000-4000-8000-000000000003',mime:'image/png',sha256:'2'.repeat(64),width:512,height:408,bytes:509458};
const original = {
  publication:{id,revisionSha256:'a'.repeat(64)},
  exhibition:{
    extensions:{'org.exhibitos.viewer/entrance':{imageAssetId:primary.assetId}},
    artworks:[{artworkType:'image',primaryAssetId:primary.assetId,
      assets:[primary,small].map(asset=>({id:asset.assetId,mime:asset.mime,bytes:asset.bytes,sha256:asset.sha256,role:'image'}))}],
  },
  assets:[primary,small].map(asset=>({assetId:asset.assetId,mime:asset.mime,url:`/api/v1/publications/${id}/assets/${asset.assetId}`})),
  coverVariants:{version:1,revisionSha256:'a'.repeat(64),primary,variants:[small]},
};
const successor = {...original,publication:{...original.publication,revisionSha256:'b'.repeat(64)}};

test('a derived scene keeps the approved 512px cover when its revision changes',()=>{
  assert.equal(validateCoverVariantDescriptor(successor),false);
  const bound=bindDerivedStaticCover(original,successor);
  assert.equal(validateCoverVariantDescriptor(bound),true);
  assert.equal(bound.coverVariants.variants[0].width,512);
  assert.deepEqual({...bound,coverVariants:successor.coverVariants},successor);
  assert.deepEqual(bound.coverVariants,{...original.coverVariants,revisionSha256:successor.publication.revisionSha256});
});

test('the compositor refuses stale authority, altered descriptors and mismatched assets',()=>{
  assert.throws(()=>bindDerivedStaticCover(successor,successor),/DERIVED_STATIC_COVER_SOURCE/);
  const altered=structuredClone(successor);
  altered.coverVariants.variants[0].sha256='3'.repeat(64);
  assert.throws(()=>bindDerivedStaticCover(original,altered),/DERIVED_STATIC_COVER_SOURCE/);
  const mismatch=structuredClone(successor);
  mismatch.exhibition.artworks[0].assets[1].sha256='4'.repeat(64);
  assert.throws(()=>bindDerivedStaticCover(original,mismatch),/DERIVED_STATIC_COVER_BINDING/);
  const unsupported=structuredClone(successor);
  delete unsupported.coverVariants;
  assert.throws(()=>bindDerivedStaticCover(original,unsupported),/DERIVED_STATIC_COVER_SOURCE/);
});
