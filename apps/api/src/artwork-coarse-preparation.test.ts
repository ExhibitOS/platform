// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect,vi} from 'vitest';
import type {Artwork} from '@exhibitos/spec';
const data=vi.hoisted(()=>{const b=Buffer.alloc(40);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(512,16);b.writeUInt32BE(408,20);return {coarse:b};});
vi.mock('./demo-display-policy.ts',()=>({qualifyDemoDisplay:()=>({coarse:{sha256:'b2a14444d4693d5b8e8e9d8a29bbcf7d88bff9ef2c2e4ffd94b84b1756018b3d',bytes:data.coarse.length,width:512,height:408}})}));
vi.mock('./viewer-variants.ts',()=>({viewerVariants:async()=>({full:{textureSize:2048},coarse:{textureSize:512},bytes:Buffer.from(data.coarse)})}));
vi.mock('./validation-client.ts',()=>({decode:async()=>({})}));
import {prepareReviewedImageCoarse} from './artwork-coarse-preparation.ts';
test('accepts only the independently reviewed worker output',async()=>{const a={artworkType:'image'} as Artwork;expect((await prepareReviewedImageCoarse(a,Buffer.from('primary'))).profile).toBe('viewer-png-box-512-v1');data.coarse[32]=1;await expect(prepareReviewedImageCoarse(a,Buffer.from('primary'))).rejects.toThrow('COARSE_POLICY_MISMATCH');});
