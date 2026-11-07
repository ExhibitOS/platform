// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {Artwork,Lifecycle} from '@exhibitos/spec';
import {validateViewerEntrance} from '@exhibitos/studio-contract';
import {artworkReplacementSnapshot} from './artwork-replacement-snapshot.ts';
import {replaceArtworkReferences} from './artwork-snapshot-replacement.ts';

it.skipIf(!process.env.EXHIBITOS_WHEAT_SAVED||!process.env.EXHIBITOS_WHEAT_FULL||!process.env.EXHIBITOS_WHEAT_COARSE)('qualifies the retained official draft and exact privately held Wheat pair',async()=>{
 const saved=JSON.parse(await readFile(process.env.EXHIBITOS_WHEAT_SAVED!,'utf8'));
 const findDraft=(value:unknown):Extract<Lifecycle,{kind:'exhibition-draft'}>|undefined=>{if(!value||typeof value!=='object')return undefined;const item=value as Record<string,unknown>;if(item.kind==='exhibition-draft'&&item.candidate&&typeof item.candidate==='object'&&Array.isArray((item.candidate as {artworks?:unknown}).artworks))return value as Extract<Lifecycle,{kind:'exhibition-draft'}>;for(const v of Object.values(value)){const found=findDraft(v);if(found)return found;}return undefined;};
 const draft=findDraft(saved);expect(draft).toBeDefined();if(!draft)throw Error('Draft missing');const prior=draft.candidate.artworks.find((a:Artwork)=>a.assets.some(asset=>asset.sha256==='2d202bfa522a54dd6e0a73063ff2eabdb7f90aae246ba9322d6505019c5bda9f'));if(!prior)throw Error('Artwork missing');
 const next=artworkReplacementSnapshot(prior,{tenantId:(prior.extensions!['org.exhibitos.studio/cms'] as {tenantId:string}).tenantId,revisionId:randomUUID(),at:new Date().toISOString(),primaryId:randomUUID(),coarseId:randomUUID(),intent:{version:1,profile:'viewer-png-box-512-v1',approvalId:'ce328328-97fa-56cf-8fc1-6bafd4573153',artworkRevision:prior.revision},originalSha256:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',primary:await readFile(process.env.EXHIBITOS_WHEAT_FULL!),coarse:await readFile(process.env.EXHIBITOS_WHEAT_COARSE!)});
 const result=replaceArtworkReferences(draft.candidate,prior,next);
 expect(result.placements.some((p:{artworkRevisionId:string;assetId:string})=>p.artworkRevisionId===next.revisionId&&p.assetId===next.primaryAssetId)).toBe(true);
 expect(validateViewerEntrance(result).valid).toBe(true);
});
