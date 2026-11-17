// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PublicPublication} from '../publication-client';
import {staticArtworkDetailAttestation} from '../static-publication-source';
import {qualifiedDetailImageProfile,hasQualifiedWheatRevision} from './detail-image-attempt';
/** Admission evidence only for the measured Wheat publication. It does not
 * imply browser cache reclamation and never gates ordinary gallery viewing. */
type CoverIdentity={sha256:string;bytes:number;mime:string};
type ImageSize={width:number;height:number};
const primary={sha256:'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7',bytes:8103573,width:2048,height:1630};
const variant={sha256:'0b0ff85114f13554a7b122a9a50cf73130f056dffa0220f7463d7ffbecd7f304',bytes:509458,width:512,height:408};
/** Verified publications with a measured Wheat detail profile track cover retirement. */
export function tracksWheatCover(revisionSha256?:string,publication?:PublicPublication):boolean{
 if(hasQualifiedWheatRevision(revisionSha256))return true;
 if(!publication||publication.publication.revisionSha256!==revisionSha256)return false;
 return publication.exhibition.artworks.some(art=>!!qualifiedDetailImageProfile(revisionSha256,art.revisionId,staticArtworkDetailAttestation(publication.local?.detailAccess,publication,art.revisionId)));
}
// A new publication component cannot forget cover work from an old instance.
// Positively retired operations are removed; uncertain cleanup remains blocked.
type CoverWork={url:string;retired:boolean;images:()=>Iterable<{src:string;isConnected:boolean}>};
const outstanding=new Set<CoverWork>();
function pruneRetired(){for(const work of outstanding){if(!work.retired||!work.url)continue;try{if(![...work.images()].some(image=>image.isConnected&&image.src===work.url))outstanding.delete(work);}catch{/* A missing DOM receipt remains outstanding. */}}}
export function createWheatCoverRetirement(images:()=>Iterable<{src:string;isConnected:boolean}>){
 let starts=0,failed=false,ready=false,url='',retired=false,noImage=false;
 return {
  // Only the cover consumer can confirm that this presentation has no image
  // work. It cannot erase a started, failed or uncertain prior operation.
  confirmNoImage(){if(starts!==0)failed=true;else noImage=true;},
  begin(identity:CoverIdentity){
   starts++;if(starts!==1||noImage)failed=true;const token:CoverWork={url:'',retired:false,images};outstanding.add(token);let decoded=false,displayed=false,ended=false;
   return {
    decoded(candidateUrl:string,size:ImageSize){
     if(ended||decoded){failed=true;return;}if(candidateUrl.startsWith('blob:')){token.url=candidateUrl;decoded=true;}const expected=[primary,variant].find(v=>v.sha256===identity.sha256&&v.bytes===identity.bytes&&identity.mime==='image/png');
     if(!expected||!candidateUrl.startsWith('blob:')||size.width!==expected.width||size.height!==expected.height){failed=true;return;}url=candidateUrl;ready=true;
    },
    displayed(candidateUrl:string){if(ended||!decoded||candidateUrl!==token.url){failed=true;return;}displayed=true;},
    fail(){failed=true;},
    retire(revoked:boolean){if(ended)return;ended=true;if(decoded&&displayed&&revoked){retired=true;token.retired=true;}else failed=true;},
   };
  },
  canAdmit(){
   pruneRetired();if(failed||outstanding.size)return false;
   if(noImage&&starts===0)return true;
   if(starts!==1||!ready||!retired)return false;
   try{for(const image of images())if(image.isConnected&&image.src===url)return false;return true;}catch{return false;}
  },
 };
}
