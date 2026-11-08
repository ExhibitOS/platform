// SPDX-License-Identifier: AGPL-3.0-or-later
import type {QualifiedDetailImage} from './detail-image-attempt';

/** Exact, loader-attested projection; these values are not a source grant. */
export interface DetailProjectionBinding {readonly indexSha256:string;readonly publicationSha256:string;readonly candidate:Readonly<{artworkRevisionId:string;sha256:string;bytes:number;mime:string;width:number;height:number}>}
export interface DetailGalleryBuffer {width:number;height:number;pixelRatio:number;devicePixelRatio:number}

/** Only the bounded Wheat image envelopes are admitted. */
export function matchesMeasuredWheatImage(profile:QualifiedDetailImage,binding:DetailProjectionBinding|undefined,gallery:DetailGalleryBuffer):boolean{
 try{
  const hash=(value:string)=>/^[a-f0-9]{64}$/.test(value);
  const viewport=profile.detailViewport,runtime=profile.runtime;
  return !!binding&&hash(profile.staticIndexSha256)&&hash(profile.publicationSha256)&&profile.staticIndexSha256===binding.indexSha256&&profile.publicationSha256===binding.publicationSha256&&profile.artworkRevisionId===binding.candidate.artworkRevisionId&&profile.sha256===binding.candidate.sha256&&profile.bytes===binding.candidate.bytes&&profile.mime===binding.candidate.mime&&profile.width===binding.candidate.width&&profile.height===binding.candidate.height&&
   hash(profile.revisionSha256)&&hash(profile.sourceBindingSha256)&&hash(profile.featureReportSha256)&&
   profile.sha256==='b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d'&&profile.bytes===8291194&&profile.mime==='image/jpeg'&&profile.width===4000&&profile.height===3184&&
   profile.reservationBytes===402653184&&(
    profile.transitionCapBytes===536870912&&profile.maxSceneBytes===104857600||
    profile.transitionCapBytes===603979776&&profile.maxSceneBytes===167772160&&profile.staticIndexSha256==='8f58935dd614adbfa231b083552c1af188fc8ce10984fdddf97d7b9f716718a2'&&profile.publicationSha256==='6c768eccdfd63868a48fd2e4d252774e1ea4d96e3fe401fa09038efee468a1af'&&profile.revisionSha256==='66595ef205a030ba360791fe75b970e9a4a536e5d4e1cf37505c49bc96f91648'&&profile.candidateId==='215dc6fe-9b03-4f69-923d-c1922ed3a492'||
    profile.transitionCapBytes===603979776&&profile.maxSceneBytes===201326592&&profile.staticIndexSha256==='c998f166a7e543c6d71157648a146c34686a59a4d71a42bf2625a7ac76d26f44'&&profile.publicationSha256==='cd8fd26f8d73024d009394ba468eedad0c08988f30e9f5c0f44d4782c673f935'&&profile.revisionSha256==='ab2e073f1b74b1989f362d35578b53c5854b8d5654c058ae81cfa0fc6ed3fd88'&&profile.artworkRevisionId==='260c29fe-17aa-4c97-bdb5-076b46b3094b'&&profile.candidateId==='68257123-c1fb-426b-93c8-b96e94dc50e5'&&profile.sourceBindingSha256==='f7a63b3aa7e67a7f39dead22babd2d21584b48d100f1237ca2b4a9901de75ca7'
   )&&profile.restoreReservationBytes===69192000&&profile.maxRestoreWidth===1280&&profile.maxRestoreHeight===800&&profile.devicePixelRatio===1&&
   gallery.width===1280&&gallery.height===800&&gallery.pixelRatio===1&&gallery.devicePixelRatio===1&&
   viewport.width===692&&viewport.height===520&&viewport.canvasWidth===692&&viewport.canvasHeight===520&&viewport.pixelRatio===1&&viewport.devicePixelRatio===1&&
   runtime.renderer==='ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'&&runtime.platform==='macOS'&&runtime.browserBrand==='Google Chrome'&&runtime.browserVersion==='156.0.8078.79'&&runtime.samples===4&&runtime.alpha===true&&runtime.depth===true&&runtime.antialias===true&&runtime.preserveDrawingBuffer===true;
 }catch{return false;}
}
