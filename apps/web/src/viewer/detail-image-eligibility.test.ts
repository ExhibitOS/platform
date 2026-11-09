// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {aristotleR9Wheat,qualifiedDetailImageProfile,type QualifiedDetailImage} from './detail-image-attempt';
import {matchesMeasuredWheatImage,type DetailProjectionBinding} from './detail-image-eligibility';
const sha='b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',a='a'.repeat(64),b='b'.repeat(64);
const binding:DetailProjectionBinding={indexSha256:a,publicationSha256:b,candidate:{artworkRevisionId:'art',sha256:sha,bytes:8291194,mime:'image/jpeg',width:4000,height:3184}};
const profile:QualifiedDetailImage={staticIndexSha256:a,publicationSha256:b,candidateId:'candidate',sha256:sha,bytes:8291194,mime:'image/jpeg',width:4000,height:3184,reservationBytes:402653184,restoreReservationBytes:69192000,transitionCapBytes:536870912,maxSceneBytes:104857600,maxRestoreWidth:1280,maxRestoreHeight:800,devicePixelRatio:1,detailViewport:{width:692,height:520,canvasWidth:692,canvasHeight:520,pixelRatio:1,devicePixelRatio:1},runtime:{renderer:'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',platform:'macOS',browserBrand:'Google Chrome',browserVersion:'156.0.8078.79',samples:4,alpha:true,depth:true,antialias:true,preserveDrawingBuffer:true},revisionSha256:a,artworkRevisionId:'art',sourceBindingSha256:a,featureReportSha256:b,inspector:'inspector',model:'model'};
const gallery={width:1280,height:800,pixelRatio:1,devicePixelRatio:1};
it('accepts only the measured source, projection, budgets, viewport and graphics configuration',()=>{
 expect(matchesMeasuredWheatImage(profile,binding,gallery)).toBe(true);
 for(const change of [{indexSha256:b},{publicationSha256:a}])expect(matchesMeasuredWheatImage(profile,{...binding,...change},gallery)).toBe(false);
 for(const change of [{artworkRevisionId:'other'},{sha256:b},{bytes:1},{mime:'image/png'},{width:3999},{height:3000}])expect(matchesMeasuredWheatImage(profile,{...binding,candidate:{...binding.candidate,...change}},gallery)).toBe(false);
 expect(matchesMeasuredWheatImage(profile,undefined,gallery)).toBe(false);
 for(const change of [{sha256:b},{bytes:1},{mime:'image/png' as const},{width:3999},{reservationBytes:310378496},{transitionCapBytes:436207616},{maxSceneBytes:104857601},{restoreReservationBytes:1},{maxRestoreWidth:1281},{devicePixelRatio:2},{staticIndexSha256:b},{publicationSha256:a}])expect(matchesMeasuredWheatImage({...profile,...change},binding,gallery)).toBe(false);
 for(const change of [{width:1279},{height:801},{pixelRatio:2},{devicePixelRatio:2}])expect(matchesMeasuredWheatImage(profile,binding,{...gallery,...change})).toBe(false);
 expect(matchesMeasuredWheatImage({...profile,detailViewport:{...profile.detailViewport,width:691}},binding,gallery)).toBe(false);
 expect(matchesMeasuredWheatImage({...profile,runtime:{...profile.runtime,samples:1}},binding,gallery)).toBe(false);
 expect(matchesMeasuredWheatImage({...profile,runtime:{...profile.runtime,browserVersion:'156.0.0.0'}},binding,gallery)).toBe(false);
});
it('admits the larger scene only for the exact Hayes publication and original binding',()=>{
 const p=qualifiedDetailImageProfile('66595ef205a030ba360791fe75b970e9a4a536e5d4e1cf37505c49bc96f91648','0316fa47-149c-43b8-942b-95280fd0052e')!;
 const attestation:DetailProjectionBinding={indexSha256:p.staticIndexSha256,publicationSha256:p.publicationSha256,candidate:{artworkRevisionId:p.artworkRevisionId,sha256:p.sha256,bytes:p.bytes,mime:p.mime,width:p.width,height:p.height}};
 expect(matchesMeasuredWheatImage(p,attestation,gallery)).toBe(true);
 for(const change of [{staticIndexSha256:a},{publicationSha256:b},{revisionSha256:a},{candidateId:'other'},{maxSceneBytes:167772161},{transitionCapBytes:603979777}])expect(matchesMeasuredWheatImage({...p,...change},attestation,gallery)).toBe(false);
 expect(qualifiedDetailImageProfile(p.revisionSha256,'other')).toBeUndefined();
 expect(qualifiedDetailImageProfile('f'.repeat(64),p.artworkRevisionId)).toBeUndefined();
});
it('admits only the exact r7 Wheat original and its measured envelope',()=>{
 const revision='ab2e073f1b74b1989f362d35578b53c5854b8d5654c058ae81cfa0fc6ed3fd88',artwork='260c29fe-17aa-4c97-bdb5-076b46b3094b';
 const p=qualifiedDetailImageProfile(revision,artwork)!;
 const attestation:DetailProjectionBinding={indexSha256:p.staticIndexSha256,publicationSha256:p.publicationSha256,candidate:{artworkRevisionId:artwork,sha256:p.sha256,bytes:p.bytes,mime:p.mime,width:p.width,height:p.height}};
 expect(matchesMeasuredWheatImage(p,attestation,gallery)).toBe(true);
 for(const change of [{staticIndexSha256:a},{publicationSha256:b},{revisionSha256:a},{artworkRevisionId:'other'},{candidateId:'other'},{sourceBindingSha256:a},{maxSceneBytes:201326593},{transitionCapBytes:603979777}])expect(matchesMeasuredWheatImage({...p,...change},attestation,gallery)).toBe(false);
 expect(qualifiedDetailImageProfile(revision,'other')).toBeUndefined();expect(qualifiedDetailImageProfile(a,artwork)).toBeUndefined();
});

it('binds the r9 Wheat original to its exact publication and existing measured limits',()=>{
 const p=qualifiedDetailImageProfile(aristotleR9Wheat.revisionSha256,aristotleR9Wheat.artworkRevisionId)!;
 const attestation:DetailProjectionBinding={indexSha256:p.staticIndexSha256,publicationSha256:p.publicationSha256,candidate:{artworkRevisionId:p.artworkRevisionId,sha256:p.sha256,bytes:p.bytes,mime:p.mime,width:p.width,height:p.height}};
 expect(matchesMeasuredWheatImage(p,attestation,gallery)).toBe(true);
 for(const change of [{staticIndexSha256:a},{sourceBindingSha256:a},{featureReportSha256:b},{candidateId:'other'},{maxSceneBytes:201326593},{transitionCapBytes:603979777}])expect(matchesMeasuredWheatImage({...p,...change},attestation,gallery)).toBe(false);
 expect(qualifiedDetailImageProfile(p.revisionSha256,'other')).toBeUndefined();
});
