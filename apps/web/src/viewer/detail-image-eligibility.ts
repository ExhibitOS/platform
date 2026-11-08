// SPDX-License-Identifier: AGPL-3.0-or-later
import type {QualifiedDetailImage} from './detail-image-attempt';

/** Exact, loader-attested projection; these values are not a source grant. */
export interface DetailProjectionBinding {readonly indexSha256:string;readonly publicationSha256:string;readonly candidate:Readonly<{artworkRevisionId:string;sha256:string;bytes:number;mime:string;width:number;height:number}>}
export interface DetailGalleryBuffer {width:number;height:number;pixelRatio:number;devicePixelRatio:number}

/** The only measured image envelope. An empty registry still disables it. */
export function matchesMeasuredWheatImage(profile:QualifiedDetailImage,binding:DetailProjectionBinding|undefined,gallery:DetailGalleryBuffer):boolean{
 try{
  const hash=(value:string)=>/^[a-f0-9]{64}$/.test(value);
  const viewport=profile.detailViewport,runtime=profile.runtime;
  return !!binding&&hash(profile.staticIndexSha256)&&hash(profile.publicationSha256)&&profile.staticIndexSha256===binding.indexSha256&&profile.publicationSha256===binding.publicationSha256&&profile.artworkRevisionId===binding.candidate.artworkRevisionId&&profile.sha256===binding.candidate.sha256&&profile.bytes===binding.candidate.bytes&&profile.mime===binding.candidate.mime&&profile.width===binding.candidate.width&&profile.height===binding.candidate.height&&
   hash(profile.revisionSha256)&&hash(profile.sourceBindingSha256)&&hash(profile.featureReportSha256)&&
   profile.sha256==='b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d'&&profile.bytes===8291194&&profile.mime==='image/jpeg'&&profile.width===4000&&profile.height===3184&&
   profile.reservationBytes===402653184&&profile.transitionCapBytes===536870912&&profile.maxSceneBytes===104857600&&profile.restoreReservationBytes===69192000&&profile.maxRestoreWidth===1280&&profile.maxRestoreHeight===800&&profile.devicePixelRatio===1&&
   gallery.width===1280&&gallery.height===800&&gallery.pixelRatio===1&&gallery.devicePixelRatio===1&&
   viewport.width===692&&viewport.height===520&&viewport.canvasWidth===692&&viewport.canvasHeight===520&&viewport.pixelRatio===1&&viewport.devicePixelRatio===1&&
   runtime.renderer==='ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'&&runtime.platform==='macOS'&&runtime.browserBrand==='Google Chrome'&&runtime.browserVersion==='156.0.8078.79'&&runtime.samples===4&&runtime.alpha===true&&runtime.depth===true&&runtime.antialias===true&&runtime.preserveDrawingBuffer===true;
 }catch{return false;}
}
