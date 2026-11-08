// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {QualifiedDetailImage} from './detail-image-attempt';
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
