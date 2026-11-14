// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {applyFurnishingCommand,furnishingsFor,WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/studio-contract';
import {snapshotFurnishings} from './scene-snapshot-furnishings';

it('retains every saved identity when visual sources, budgets or mounts are unavailable',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),doc=structuredClone(original.exhibition),light=doc.lights[0]!;
 light.type='spot';light.beamAngle=Math.PI/4;
 const candidate=applyFurnishingCommand(doc,{type:'set-furnishing-visual',hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}}),asset=furnishingsFor(candidate)!.assets[0]!;
 const furnishingId=crypto.randomUUID(),placementId=crypto.randomUUID(),frameId=crypto.randomUUID(),openingId=crypto.randomUUID(),sha='a'.repeat(64);
 candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:1,furnishings:[{id:furnishingId,version:1,model:{sha256:sha}}],placements:[{id:placementId,furnishingId,furnishingVersion:1}],frameAttachments:[{placementId:frameId,furnishingId,furnishingVersion:1}],openingAttachments:[{openingId,furnishingId,furnishingVersion:1}],ceilingAttachments:[{placementId}]};
 const report=snapshotFurnishings(candidate,()=>false,()=> 'failed');
 expect(report.catalog).toEqual([{kind:'light',id:light.id,assetId:asset.id,modelSha256:asset.sha256,status:'fallback'}]);
 expect(report.workspace).toEqual([placementId,frameId,openingId].map(id=>({placementId:id,furnishingId,furnishingVersion:1,modelSha256:sha,status:'failed'})));
 const mounted=snapshotFurnishings(candidate,(kind,id)=>kind==='light'&&id===light.id,id=>id===placementId?'ready':'pending');
 expect(mounted.catalog[0]!.status).toBe('ready');expect(mounted.workspace.map(row=>row.status)).toEqual(['ready','pending','pending']);
 expect(mounted.workspace.map(({status:_,...identity})=>identity)).toEqual(report.workspace.map(({status:_,...identity})=>identity));
});
