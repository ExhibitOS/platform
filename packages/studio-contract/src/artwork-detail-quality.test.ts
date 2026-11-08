// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {freezeCanonical} from './freeze.js';
import {validateParsedDetailQuality,verifiedParsedDetailQuality,type DetailCandidate,type DetailQualityRelation} from './artwork-detail-quality.js';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hex=(v:string)=>v.repeat(64);
const digest=(v:unknown)=>createHash('sha256').update(freezeCanonical(v)).digest('hex');
function imageCandidate(n:number,tier:DetailCandidate['tier']):DetailCandidate{
 const featureReport:DetailCandidate['featureReport']={version:1,inspector:'synthetic-image-v1',assetSha256:hex('a'),assetBytes:100,media:{kind:'image',codec:'png',width:512,height:400,bitDepth:8,channels:3,frameCount:1,interlaced:false,orientation:1,colourProfile:'srgb'},cost:{model:'synthetic-only',residentBytes:1024,peakAdditionalBytes:2048}};
 return {candidateId:id(n),assetId:id(n+10),tier,sha256:featureReport.assetSha256,bytes:featureReport.assetBytes,mime:'image/png',sourceBindingSha256:hex('b'),featureReportSha256:digest(featureReport),featureReport};
}
const fixture=():DetailQualityRelation=>({version:1,candidates:[imageCandidate(1,'acquired-original'),imageCandidate(2,'approved-full'),imageCandidate(3,'lightweight')]});
it('validates ordered parsed identity and verifies canonical feature digests without claiming source authority',async()=>{
 const relation=fixture();expect(validateParsedDetailQuality(relation,'image').valid).toBe(true);const verified=await verifiedParsedDetailQuality(relation,'image');expect(verified).toEqual(relation);expect(Object.isFrozen(verified?.candidates[0]?.featureReport.media)).toBe(true);
 const report=relation.candidates[0]!.featureReport;if(report.media.kind!=='image')throw Error('fixture');report.media.width++;
 expect(validateParsedDetailQuality(relation,'image').valid).toBe(true);expect(await verifiedParsedDetailQuality(relation,'image')).toBeUndefined();
});
it('returns the verified immutable snapshot even if the original changes while hashing',async()=>{
 const input=fixture(),pending=verifiedParsedDetailQuality(input,'image'),media=input.candidates[0]!.featureReport.media;if(media.kind!=='image')throw Error('fixture');media.width=513;
 const verified=await pending;if(!verified)throw Error('expected valid snapshot');const snapshot=verified.candidates[0]!.featureReport.media;if(snapshot.kind!=='image')throw Error('fixture');expect(snapshot.width).toBe(512);expect(Object.isFrozen(verified.candidates)).toBe(true);expect(Object.isFrozen(snapshot)).toBe(true);
});
it('rejects duplicate identities, tiers, unknown fields and contradictory byte identity',()=>{
 const inputs:unknown[]=[];const duplicate=fixture();duplicate.candidates[1]!.candidateId=duplicate.candidates[0]!.candidateId;inputs.push(duplicate);
 const repeated=fixture();repeated.candidates[1]!.assetId=repeated.candidates[0]!.assetId;inputs.push(repeated);
 const order=fixture();order.candidates.reverse();inputs.push(order);
 const tier=fixture();tier.candidates[1]!.tier='acquired-original';inputs.push(tier);
 const altered=fixture();altered.candidates[1]!.bytes=101;altered.candidates[1]!.featureReport.assetBytes=101;inputs.push(altered);
 const media=fixture();media.candidates[1]!.mime='image/jpeg';if(media.candidates[1]!.featureReport.media.kind==='image')media.candidates[1]!.featureReport.media.codec='jpeg';inputs.push(media);
 inputs.push({...fixture(),privateKey:'not allowed'});const extra=fixture();Object.assign(extra.candidates[0]!.featureReport.cost,{untrusted:true});inputs.push(extra);
 const invalid=fixture();invalid.candidates[0]!.featureReport.cost.peakAdditionalBytes=Number.MAX_SAFE_INTEGER+1;inputs.push(invalid);
 for(const field of ['codec','colourProfile'] as const){const bad=fixture(),report=bad.candidates[0]!.featureReport;if(report.media.kind!=='image')throw Error('fixture');Object.assign(report.media,{[field]:[field==='codec'?'png':'srgb']});bad.candidates[0]!.featureReportSha256=digest(report);inputs.push(bad);}
 const invalidMime=fixture();Object.assign(invalidMime.candidates[0]!,{mime:['image/png']});inputs.push(invalidMime);
 for(const value of inputs)expect(validateParsedDetailQuality(value,'image').valid).toBe(false);
 expect(validateParsedDetailQuality(fixture(),'sculpture').valid).toBe(false);
});
it('permits a bounded zero-texture GLB and rejects duplicate embedded image indices or external references',()=>{
 const candidate=imageCandidate(1,'approved-full');candidate.mime='model/gltf-binary';candidate.featureReport.media={kind:'glb',glbVersion:2,sceneCount:1,nodeCount:1,primitiveCount:1,drawCount:1,triangles:12,geometryCpuBytes:120,geometryGpuBytes:120,textures:[],requiredExtensions:[],externalReferences:false};
 const relation={version:1,candidates:[candidate]};expect(validateParsedDetailQuality(relation,'sculpture').valid).toBe(true);
 const bad=structuredClone(relation),model=bad.candidates[0]!.featureReport.media;if(model.kind!=='glb')throw Error('fixture');
 model.textures=[{imageIndex:0,codec:'png',width:32,height:32,encodedBytes:10,mipLevels:1,usesMipmaps:false,textureReferences:1},{imageIndex:0,codec:'png',width:32,height:32,encodedBytes:10,mipLevels:1,usesMipmaps:false,textureReferences:1}];expect(validateParsedDetailQuality(bad,'sculpture').valid).toBe(false);
 model.textures.pop();Object.assign(model.textures[0]!,{codec:['png']});expect(validateParsedDetailQuality(bad,'sculpture').valid).toBe(false);
 const external=structuredClone(relation);Object.assign(external.candidates[0]!.featureReport.media,{externalReferences:true});expect(validateParsedDetailQuality(external,'sculpture').valid).toBe(false);
});
