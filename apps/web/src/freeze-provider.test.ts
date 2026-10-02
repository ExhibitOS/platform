// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {freezeCanonical,type FreezeBundle} from '@exhibitos/studio-contract';
import {readOex} from '@exhibitos/spec';
import {decodeFreezeOex,freezeHash} from './freeze-oex';
import {frozenPublication,matchOfflineAuthority} from './OfflineExhibition';
import {fetchVerifiedAsset} from './viewer/loading';
import {authorityScope,freezeRecordKey,type OfflineAuthority} from './freeze-cache';
async function fixture(){
 const raw=await readFile(new URL('../../../node_modules/@exhibitos/spec/oex/v1/examples/synthetic-media.oex',import.meta.url)),reference=await readOex(raw),hash=await freezeHash(new TextEncoder().encode(freezeCanonical(reference.exhibition)));
 const oex=await decodeFreezeOex(raw,hash);
 // This isolated provider test begins after signed verification; shared signature tests cover verification.
 const authority:OfflineAuthority={authority:{origin:'https://source.invalid',keyId:'1'.repeat(64),publicKey:'verified-key'},tenantId:'10000000-0000-4000-8000-000000000001',subjectId:'10000000-0000-4000-8000-000000000002',expiresAt:'2030-01-01T00:00:00Z'};
 const bundle={manifest:{id:'10000000-0000-4000-8000-000000000003',source:{exhibitionHash:hash},createdAt:'2026-10-02T09:00:00Z',authority:authority.authority},authorization:{grant:{origin:authority.authority.origin,keyId:authority.authority.keyId,tenantId:authority.tenantId,subjectId:authority.subjectId,issuedAt:'2026-10-02T09:00:00Z'}}} as FreezeBundle;
 return {oex,bundle,authority};
}
afterEach(()=>vi.restoreAllMocks());
describe('verified offline renderer provider',()=>{
 it('uses the actual renderer integrity loader for GLB, PNG and WAV with zero global fetch calls',async()=>{
  const {oex,bundle}=await fixture(),network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('network forbidden')),check=vi.fn(async()=>{}),publication=frozenPublication(bundle,oex,check);
  for(const inventory of [...oex.exhibition.artworks.flatMap(a=>a.assets),...oex.exhibition.mediaAssets]){
   const asset=publication.assets.find(a=>a.assetId===inventory.id)!;
   const bytes=await fetchVerifiedAsset({publicationId:publication.publication.id,revisionSha256:publication.publication.revisionSha256,asset,inventory,signal:new AbortController().signal,...publication.local});
   expect(new Uint8Array(bytes)).toEqual(oex.assets.get(asset.assetId)!.bytes);
  }
  expect(check.mock.calls.length).toBeGreaterThanOrEqual(6);expect(network).not.toHaveBeenCalled();
 });
 it('denies arbitrary URLs, mutated cached bytes and permission expiry without network fallback',async()=>{
  const {oex,bundle}=await fixture(),network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('network forbidden'));let allowed=true;const publication=frozenPublication(bundle,oex,async()=>{if(!allowed)throw Error('expired');}),provider=publication.local!.fetcher;
  await expect(provider('https://other.invalid/art.png')).rejects.toThrow('OFFLINE_ASSET_URL');
  const asset=publication.assets[0]!,data=oex.assets.get(asset.assetId)!;data.bytes[0]=data.bytes[0]!^1;
  await expect(provider(asset.url)).rejects.toThrow('OFFLINE_ASSET_INTEGRITY');allowed=false;
  await expect(provider(publication.assets[1]!.url)).rejects.toThrow('expired');expect(network).not.toHaveBeenCalled();
 });
 it('denies profile/key changes and uses separate immutable cache keys for renewed grants',async()=>{
  const {bundle,authority}=await fixture();expect(()=>matchOfflineAuthority(authority,bundle)).not.toThrow();
  expect(()=>matchOfflineAuthority({...authority,subjectId:'other'},bundle)).toThrow('OFFLINE_PROFILE');
  expect(()=>matchOfflineAuthority({...authority,authority:{...authority.authority,publicKey:'different'}},bundle)).toThrow('OFFLINE_PROFILE');
  const renewed=structuredClone(bundle);renewed.authorization.grant.issuedAt='2026-10-02T10:00:00Z';expect(freezeRecordKey(authority,bundle)).not.toBe(freezeRecordKey(authority,renewed));expect(authorityScope(authority)).not.toBe(authorityScope({...authority,tenantId:'different'}));
 });
});
