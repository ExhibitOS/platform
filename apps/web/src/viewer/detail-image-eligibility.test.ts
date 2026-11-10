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

it('admits the r46 Wheat original only with the r46 publication attestation',()=>{
 const revision='02420a0e67800e3d957734414f92d99b977c9534172cbd613a8c0ef30f50bd15';
 const artworkRevisionId='157793b9-2f6c-41d4-8688-686b30554a58';
 const r46=qualifiedDetailImageProfile(revision,artworkRevisionId)!;
 const attestation:DetailProjectionBinding={
  indexSha256:'c3b6ba70e888a20416e40f34a99c328134c122e423b499f3682b0ea896cac17e',
  publicationSha256:'474763f2b2f46b2877f6cd176fcd1351108c4220ba5423c85f08c8c6eb48a2c2',
  candidate:{...binding.candidate,artworkRevisionId},
 };
 expect(matchesMeasuredWheatImage(r46,attestation,gallery)).toBe(true);
 expect(qualifiedDetailImageProfile(revision,'8f1c52ac-9dfe-4cd7-8e66-357357c5cdc0')).toBeUndefined();
 expect(matchesMeasuredWheatImage(r46,{...attestation,indexSha256:'866fd62a1ca3babb0f150e8895ce4255cd5c72b0059574f1de3033a8515fd880'},gallery)).toBe(false);
});

it('admits the r52 Wheat original only with the r52 publication attestation',()=>{
 const revision='abdf3ca07a33d9ad2a9c63a46b640ac2f6b9cac763ba3f19ed57d73c57a25292';
 const artworkRevisionId='d7709511-4d09-4c4f-a08c-1c75888b3b0e';
 const r52=qualifiedDetailImageProfile(revision,artworkRevisionId)!;
 const attestation:DetailProjectionBinding={
  indexSha256:'eae9524c7d1c1232012b9c3a6d1612288485fa51260a369597802e1c7f3c0b8a',
  publicationSha256:'8685c98477ec9bda7316e98469726734cfe67f7f54a5431c2cea24ce26e34cfc',
  candidate:{...binding.candidate,artworkRevisionId},
 };
 expect(matchesMeasuredWheatImage(r52,attestation,gallery)).toBe(true);
 expect(qualifiedDetailImageProfile(revision,'157793b9-2f6c-41d4-8688-686b30554a58')).toBeUndefined();
 expect(matchesMeasuredWheatImage(r52,{...attestation,publicationSha256:'474763f2b2f46b2877f6cd176fcd1351108c4220ba5423c85f08c8c6eb48a2c2'},gallery)).toBe(false);
});

it('admits the r53 Wheat original only with the r53 publication attestation',()=>{
 const revision='bb4a21f1fa4d5e8a0bc64885b08c06f2a72a346a5a43da86aa81a68583451322';
 const artworkRevisionId='6b1cd4e6-2afc-4766-8776-fb553d3b90bd';
 const r53=qualifiedDetailImageProfile(revision,artworkRevisionId)!;
 const attestation:DetailProjectionBinding={
  indexSha256:'79541417f1248a4c335c72cdaf9a84906f4558d261782cf0107266bb8f60ce2e',
  publicationSha256:'cdef470d858b51723ae5598e4a648df04a4bdd5ef91f8eaa24fe2ed461ba6de3',
  candidate:{...binding.candidate,artworkRevisionId},
 };
 expect(matchesMeasuredWheatImage(r53,attestation,gallery)).toBe(true);
 expect(qualifiedDetailImageProfile(revision,'d7709511-4d09-4c4f-a08c-1c75888b3b0e')).toBeUndefined();
 expect(matchesMeasuredWheatImage(r53,{...attestation,publicationSha256:'8685c98477ec9bda7316e98469726734cfe67f7f54a5431c2cea24ce26e34cfc'},gallery)).toBe(false);
});
