// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {reviewedPassiveLayout} from './default-catalogue-reviewed-release.mjs';

const hash=body=>createHash('sha256').update(body).digest('hex');
const glb=await readFile(new URL('./fixtures/rail-v11/linear-track.glb',import.meta.resolve('@exhibitos/spec')));
const notice=Buffer.from('ExhibitOS CC0-1.0');
const original=Buffer.from('retained bytes');
const retained={catalogId:'existing',catalogVersion:1};
const schema='org.exhibitos.default-furnishings/v1';
const record=(path,body)=>({path,bytes:body.length,sha256:hash(body)});
const model=record('assets/furnishings/any-new-rail/model.glb',glb);
const license=record('assets/furnishings/any-new-rail/LICENSE-NOTICE.txt',notice);
const baseline={manifest:{schema,bundleVersion:'1.22.0',assets:[retained]},items:[
  {id:'existing',version:1,descriptorSha256:hash(JSON.stringify(retained)),files:[record('assets/existing.glb',original)]},
]};
const rail={catalogId:'any-new-rail',catalogVersion:1,name:'Verified rail',hostKind:'ceiling-rail',
  model:{...model,mime:'model/gltf-binary'},rights:{licenseId:'CC0-1.0',notice:license},
  provenance:{sourceSha256:model.sha256,recipe:'original-v1'},
  workspaceFurnishing:{id:'fb8d8fbd-61cd-4adc-9f00-65fc67f9f4dd',version:1,kind:'ceiling-rail',name:'Verified rail',provenance:'Publisher-owned unchanged original.',
    model:{bytes:model.bytes,sha256:model.sha256,mime:'model/gltf-binary'},
    rights:{licenseId:'CC0-1.0',ownership:'owner',holder:'ExhibitOS',creditLine:'ExhibitOS',permissions:{display:true,export:true,download:true,commercial:true}},
    fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,
      geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}},
  }};
const sourceCommit='1'.repeat(40);
const describe=(name,body)=>({name,bytes:body.length,sha256:hash(body)});
function request(row=rail,old=retained){
  const bytes=Buffer.from(JSON.stringify({schema,bundleVersion:'1.23.0',assets:[old,row]}));
  const metadata=Buffer.from(JSON.stringify({
    schema:'org.exhibitos.default-catalogue-release/v1',bundleSchema:schema,bundleVersion:'1.23.0',minimumManagerVersion:'0.1.0',
    requiredCapabilities:['workspace-artwork-frame-models-v1','workspace-ceiling-rail-v1','source-bound-fit-v1','workspace-portal-finish-v1','modular-portal-v1','default-seat-proposal-v1'],
    sourceCommit,manifest:{bytes:bytes.length,sha256:hash(bytes)},
    items:[baseline.items[0],{id:row.catalogId,version:1,descriptorSha256:hash(JSON.stringify(row)),files:[license,model]}],
  })+'\n');
  const attachments=[
    ...[original,glb,notice].map(body=>describe('catalogue-body-'+hash(body),body)),
    describe('catalogue-release-v1.json',metadata),describe('default-furnishings-manifest.json',bytes),
  ].sort((a,b)=>a.name.localeCompare(b.name));
  return {bytes,review:{sourceCommit,manifestBytes:bytes.length,manifestSha256:hash(bytes),attachments}};
}
const body=path=>new Map([[model.path,glb],[license.path,notice],['assets/existing.glb',original]]).get(path);
const mismatch=/DEFAULT_CATALOGUE_LAYOUT_REVIEW_MISMATCH/;

test('derives the independently pinned inventory for a later release without generating a packet',async()=>{
  const {bytes,review}=request();
  const layout=await reviewedPassiveLayout(baseline,bytes,review,body);
  assert.deepEqual(layout.inventory,review.attachments);
  assert.deepEqual(await layout.verifiedBody(license),notice);
  await assert.rejects(()=>layout.verifiedBody({...license,sha256:'a'.repeat(64)}),mismatch);
});

test('rejects altered old rows, unreviewed attachments and wrong role, rights or measured fit',async()=>{
  const {bytes,review}=request();
  await assert.rejects(()=>reviewedPassiveLayout(baseline,bytes,{...review,manifestBytes:bytes.length+1},body),mismatch);
  await assert.rejects(()=>reviewedPassiveLayout(baseline,bytes,{...review,attachments:review.attachments.slice(1)},body),mismatch);
  const wrongFit=structuredClone(rail);wrongFit.workspaceFurnishing.fit.geometry.min[0]=-.51;
  const wrongRights=structuredClone(rail);wrongRights.workspaceFurnishing.rights.permissions.export=false;
  for(const input of [request(rail,{...retained,name:'altered'}),request({...rail,hostKind:'artwork-frame'}),request(wrongFit),request(wrongRights)]){
    await assert.rejects(()=>reviewedPassiveLayout(baseline,input.bytes,input.review,body),mismatch);
  }
});
