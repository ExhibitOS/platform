// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {INSTALLATION_NAMESPACE as N,validateStudioInstallation} from '@exhibitos/studio-contract';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
async function fixture(){
 const decoded=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),d=decoded.exhibition,p=d.placements[0]!;
 d.extensions={...d.extensions,[N]:{version:1,placements:[{placementId:p.id,pedestal:{kind:'box',position:[0,0,0],yaw:0,dimensions:{width:1,depth:1,height:.8},material:{preset:'paint',color:'#FFFFFF',roughness:0,metalness:0}}}]}};
 return {decoded,d};
}
test('browser draft and OEX boundary both admit valid installation and reject malformed/foreign references',async()=>{
 const {d}=await fixture(),draft=newDraft();draft.candidate=d;draft.exhibitionId=d.id;expect(validateDraft(draft).valid).toBe(true);expect(()=>checkOexProfile(d)).not.toThrow();
 const bad=structuredClone(d);(bad.extensions![N] as unknown as {placements:{placementId:string}[]}).placements[0]!.placementId=crypto.randomUUID();draft.candidate=bad;expect(validateDraft(draft).valid).toBe(false);expect(()=>checkOexProfile(bad)).toThrow('OEX_PROFILE_INVALID');
});
test('OEX remaps typed installation placement binding and preserves exact factors without source mutation',async()=>{
 const {d}=await fixture(),before=JSON.stringify(d),mapped=remapOex(d).exhibition;
 expect(validateStudioInstallation(mapped).valid).toBe(true);const binding=(mapped.extensions![N] as unknown as {placements:{placementId:string;pedestal:{material:{roughness:number;metalness:number}}}[]}).placements[0]!;
 expect(binding.placementId).toBe(mapped.placements[0]!.id);expect(binding.placementId).not.toBe(d.placements[0]!.id);expect(binding.pedestal.material).toMatchObject({roughness:0,metalness:0});expect(JSON.stringify(d)).toBe(before);
});
test('public projection carries only qualified installation metadata and remaps its selected placement',async()=>{
 const {d,decoded}=await fixture(),prepared=d.artworks.map(artwork=>{const a=artwork.assets.find(a=>a.id===artwork.primaryAssetId)!,entry=decoded.manifest.assets.find(entry=>entry.id===a.id),bytes=entry&&decoded.files.get(entry.path);if(!bytes)throw Error('TEST_FIXTURE_ASSET_MISSING');return {artwork,sourceAssetId:a.id,sourceSha256:a.sha256,bytes:Buffer.from(bytes),mime:a.mime as 'image/png'|'model/gltf-binary'};}),before=JSON.stringify(d);
 const projected=projectPublication(d,prepared,'2026-10-23T00:00:00.000Z').snapshot;expect(validateStudioInstallation(projected).valid).toBe(true);expect((projected.extensions![N] as unknown as {placements:{placementId:string}[]}).placements[0]!.placementId).toBe(projected.placements[0]!.id);expect(JSON.stringify(d)).toBe(before);
 const bad=structuredClone(d);(bad.extensions![N] as unknown as Record<string,unknown>).unknown=true;expect(()=>projectPublication(bad,prepared,'2026-10-23T00:00:00.000Z')).toThrow('PUBLICATION_NOT_READY');
});
