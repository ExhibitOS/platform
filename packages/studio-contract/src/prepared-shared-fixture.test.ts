// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {fixtureURL,validateExhibition,validateFurnishingInventory,type Exhibition} from '@exhibitos/spec';
import {USER_ASSET_CATALOGUE} from './user-asset-catalogue.js';
import {PREPARED_SHARED_FIXTURES} from './prepared-shared-fixture.js';
import {applyFurnishingCommand,furnishingAsset,furnishingCatalogueEntry,validateFurnishings} from './furnishings.js';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
it('preserves all23 historical records and overrides only the current prepared lookup',()=>{
 const text=readFileSync(new URL('./user-asset-catalogue.ts',import.meta.url));expect(hash(text.subarray(text.indexOf('export const USER_ASSET_CATALOGUE')))).toBe('7b5855f199a16601602d2b8eaa7f683809d03cd719efba5a79859a61110942c4');expect(USER_ASSET_CATALOGUE).toHaveLength(23);
 const old=USER_ASSET_CATALOGUE.find(x=>x.id==='museum-wallwasher')!,current=furnishingCatalogueEntry('museum-wallwasher');expect(old.path).toContain('user-authored-20261027');expect(old.rights.noticeBytes).toBe(2282);expect(old.provenance.recipe).toBe('omit-unused-tangent-v1');expect(current).toBe(PREPARED_SHARED_FIXTURES['museum-wallwasher']);expect(current.bounds).toEqual(old.bounds);expect(current.functional).toEqual(old.functional);expect(current.provenance.recipe).toBe('omit-unused-invalid-tangent-r1');expect(current.rights.noticeBytes).toBe(1115);
});
it('maps the feature preparation policy to the existing public omission recipe without leaking custody fields',()=>{
 const asset=furnishingAsset('a0000000-0000-4000-8000-000000000099','museum-wallwasher');expect(asset.provenance).toEqual({sourceSha256:PREPARED_SHARED_FIXTURES['museum-wallwasher']!.provenance.sourceSha256,recipe:'omit-unused-tangent-v1'});expect(asset).not.toHaveProperty('preparation');
 const e=JSON.parse(readFileSync(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,light=e.lights[0]!;light.type='spot';light.unit='candela';light.beamAngle=Math.PI/4;light.transform.position=[0,2,0];delete light.targetPlacementId;
 const candidate=applyFurnishingCommand(e,{type:'set-furnishing-visual',hostKind:'light',hostId:light.id,catalogId:'museum-wallwasher',catalogVersion:1,pose:{position:[0,.106,.05],yaw:0,scale:1}},{newAssetId:asset.id});
 expect(validateFurnishings(candidate).valid).toBe(true);expect(validateFurnishingInventory(candidate).valid).toBe(true);expect(validateExhibition(candidate).valid).toBe(true);
 const leaked=JSON.parse(JSON.stringify(candidate));leaked.extensions['org.exhibitos.studio/furnishing-visuals'].assets[0].provenance.recipe='omit-unused-invalid-tangent-r1';expect(validateFurnishingInventory(leaked).valid).toBe(false);
});
const payload=process.env.EXHIBITOS_PREPARED_SHARED_FIXTURE_ROOT;
it.skipIf(!payload)('binds all six release payload bytes and source/output receipt to the internal current record',()=>{
 const e=furnishingCatalogueEntry('museum-wallwasher'),files=[{path:e.path,bytes:e.bytes,sha256:e.sha256},{path:e.rights.noticePath,bytes:e.rights.noticeBytes,sha256:e.rights.noticeSha256},...e.preparation!.files];expect(files).toHaveLength(6);
 for(const f of files){const b=readFileSync(join(payload!,f.path));expect(b.length).toBe(f.bytes);expect(hash(b)).toBe(f.sha256);}
 const receipt=JSON.parse(readFileSync(join(payload!,e.preparation!.files.find(f=>f.path.endsWith('/producer-receipt.json'))!.path),'utf8'));expect(receipt.source.sha256).toBe(e.provenance.sourceSha256);expect(receipt.renderable.sha256).toBe(e.sha256);expect(receipt.preparation.policy).toBe(e.provenance.recipe);expect(receipt.workerDrained).toBe(true);
});
