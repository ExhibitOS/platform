// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {LoadingManager} from 'three';
import {embeddedPNGManager} from '../embedded-glb';
import {inspectAdoptedModelDetail} from '../../../api/src/adopted-model-detail-report.ts';
import {checkAcquiredModelGeometry,eligibleAcquiredModel,embeddedJpegSize} from './detail-model-admission';

it('reads embedded JPEG dimensions before decode and refuses broken segment bounds',()=>{
 const jpeg=Uint8Array.from([255,216,255,224,0,4,0,0,255,192,0,11,8,16,0,16,0,1,1,17,0,255,217]);
 expect(embeddedJpegSize(jpeg)).toEqual({width:4096,height:4096});
 const bad=Uint8Array.from(jpeg);bad[5]=100;
 expect(embeddedJpegSize(bad)).toBeUndefined();
 expect(embeddedJpegSize(jpeg.subarray(0,-2))).toBeUndefined();
});

const retained=process.env.EXHIBITOS_OAM_ORIGINAL;
it.skipIf(!retained)('admits the exact acquired model only with its desktop limits and matching GLB header',async()=>{
 const bytes=await readFile(retained!);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 expect(sha256).toBe('b79822fc08c007120de51cbaebf1caf71bd7387ac27c43b5bf9326c93540b0b3');
 const featureReport=await inspectAdoptedModelDetail(bytes,{sha256,bytes:bytes.length});
 const candidate={candidateId:'candidate',assetId:'asset',tier:'acquired-original',mime:'model/gltf-binary',sha256,bytes:bytes.length,
  featureReport,featureReportSha256:'',sourceBindingSha256:''} as const;
 expect(eligibleAcquiredModel(candidate,150000,2048)).toBeUndefined();
 expect(eligibleAcquiredModel(candidate,100000,4096)).toBeUndefined();
 const profile=eligibleAcquiredModel(candidate,150000,4096)!;
 expect(profile.cost).toMatchObject({residentBytes:478772610,peakAdditionalBytes:520199070});
 expect(()=>checkAcquiredModelGeometry(Uint8Array.from(bytes).buffer,profile.media)).not.toThrow();
 expect(()=>checkAcquiredModelGeometry(Uint8Array.from(bytes).buffer,{...profile.media,triangles:1})).toThrow('DETAIL_MODEL_PROFILE');
 expect(()=>embeddedPNGManager(new LoadingManager(),Uint8Array.from(bytes).buffer)).toThrow('EXTERNAL_RESOURCE_REJECTED');
 const retainedModel=embeddedPNGManager(new LoadingManager(),Uint8Array.from(bytes).buffer,undefined,profile.media.textures);
 retainedModel.dispose();await retainedModel.drain();retainedModel.retire();
 expect(retainedModel.cleanupOK()).toBe(true);
});
