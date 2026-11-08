// SPDX-License-Identifier: AGPL-3.0-or-later
/** Admission evidence only for the measured Wheat publication. It does not
 * imply browser cache reclamation and never gates ordinary gallery viewing. */
type CoverIdentity={sha256:string;bytes:number;mime:string};
type ImageSize={width:number;height:number};
const primary={sha256:'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7',bytes:8103573,width:2048,height:1630};
const variant={sha256:'0b0ff85114f13554a7b122a9a50cf73130f056dffa0220f7463d7ffbecd7f304',bytes:509458,width:512,height:408};
/** Only the exact publications with a qualified Wheat detail profile track cover retirement. */
export function tracksWheatCover(revision:string|undefined){return revision==='41b47f3af2adc536df77a91dcd2918aa527c6343b3b75c31c319b8a0aafe34b8'||revision==='66595ef205a030ba360791fe75b970e9a4a536e5d4e1cf37505c49bc96f91648';}
// A new publication component cannot forget cover work from an old instance.
// Positively retired operations are removed; uncertain cleanup remains blocked.
type CoverWork={url:string;retired:boolean;images:()=>Iterable<{src:string;isConnected:boolean}>};
const outstanding=new Set<CoverWork>();
function pruneRetired(){for(const work of outstanding){if(!work.retired||!work.url)continue;try{if(![...work.images()].some(image=>image.isConnected&&image.src===work.url))outstanding.delete(work);}catch{/* A missing DOM receipt remains outstanding. */}}}
export function createWheatCoverRetirement(images:()=>Iterable<{src:string;isConnected:boolean}>){
 let starts=0,failed=false,ready=false,url='',retired=false;
 return {
  begin(identity:CoverIdentity){
   starts++;if(starts!==1)failed=true;const token:CoverWork={url:'',retired:false,images};outstanding.add(token);let decoded=false,displayed=false,ended=false;
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
   pruneRetired();if(failed||starts!==1||!ready||!retired||outstanding.size)return false;
   try{for(const image of images())if(image.isConnected&&image.src===url)return false;return true;}catch{return false;}
  },
 };
}
