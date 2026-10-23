// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import type {Artwork} from '@exhibitos/spec';
import {DISPLAY_POLICY_NAMESPACE as N,validateArtworkDisplayPolicy,artworkDisplayPolicy} from './display-policy.js';
const hash='a'.repeat(64),id='aaaaaaaa-0000-4000-8000-000000000001';
const art=()=>({primaryAssetId:id,assets:[{id,sha256:hash}],rights:{licenseId:'CC0-1.0'}} as unknown as Artwork);
const policy=()=>({version:1,profile:'approved-open-access-demo-v1',approvalId:id,sourceAssetSha256:hash,rightsEvidenceSha256:'b'.repeat(64)});
test('CC0 or display permission alone never creates an explicit selected-file exception',()=>{const a=art();expect(validateArtworkDisplayPolicy(a).valid).toBe(true);expect(artworkDisplayPolicy(a)).toBeUndefined();});
test('closed namespace preserves only exact primary SHA metadata, with no mutation',()=>{const a=art();a.extensions={[N]:policy()};const before=structuredClone(a);expect(validateArtworkDisplayPolicy(a).valid).toBe(true);const p=artworkDisplayPolicy(a)!;p.sourceAssetSha256='c'.repeat(64);expect(a).toEqual(before);});
test('unknown fields/profile/version, malformed hashes and mismatched primary fail closed',()=>{
 for(const value of [{...policy(),version:2},{...policy(),profile:'CC0'},{...policy(),extra:true},{...policy(),approvalId:'not-approved'},{...policy(),rightsEvidenceSha256:'b'.repeat(63)},{...policy(),sourceAssetSha256:'c'.repeat(64)},null]){const a=art();a.extensions={[N]:value};expect(validateArtworkDisplayPolicy(a).valid).toBe(false);expect(()=>artworkDisplayPolicy(a)).toThrow('DISPLAY_POLICY_INVALID');}
});
