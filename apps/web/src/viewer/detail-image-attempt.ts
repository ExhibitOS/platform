// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {DetailAccess} from '../publication-client';
import {DetailAccessFailure} from '../detail-access-failure';
import {createDetailAttemptSlot} from './detail-attempt';
import type {AssetPeakBudget} from './loading';
import type {DetailRuntimeProfile} from './detail-runtime-profile';

/** One independently qualified image, bound to the exact static relation.
 * The producer/Viewer qualification boundary must establish this before calling;
 * image dimensions, a hash, or a hardware hint alone do not establish it. */
export interface QualifiedDetailImage {
 staticIndexSha256:string;publicationSha256:string;candidateId:string;sha256:string;bytes:number;mime:'image/png'|'image/jpeg';width:number;height:number;
 reservationBytes:number;restoreReservationBytes:number;transitionCapBytes:number;maxSceneBytes:number;maxRestoreWidth:number;maxRestoreHeight:number;devicePixelRatio:number;detailViewport:DetailImageViewport;runtime:DetailRuntimeProfile;revisionSha256:string;artworkRevisionId:string;sourceBindingSha256:string;featureReportSha256:string;inspector:string;model:string;
}
export type DetailImageSlot=ReturnType<typeof createDetailAttemptSlot<DetailImageResource>>;
interface DetailImageResource {bitmap:ImageBitmap;texture:Three.Texture;geometry:Three.PlaneGeometry;material:Three.MeshBasicMaterial;object:Three.Mesh}
export class DetailImageBudgetRefusal extends Error {
 constructor(readonly attemptId:string,readonly generation:number,readonly requestedBytes:number,readonly currentBytes:number,readonly capBytes:number,readonly sceneCapBytes:number){super('DETAIL_IMAGE_BUDGET_REFUSED');}
}
/** One measured and independently reviewed static publication, never a grant. */
const measuredWheat:QualifiedDetailImage=Object.freeze({staticIndexSha256:"8de1650dfcb0e43aafae1f8c181293a0a88fe18c58acd2389c32de0c7bde91a1",publicationSha256:"ecf6a63b2a97ae5a08ea996eb342bea7bbfe736a0227fb47df33c0b1635758c9",candidateId:"a05143a1-eb94-48cf-997f-3506b26a16cc",sha256:"b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d",bytes:8291194,mime:"image/jpeg",width:4000,height:3184,reservationBytes:402653184,restoreReservationBytes:69192000,transitionCapBytes:536870912,maxSceneBytes:104857600,maxRestoreWidth:1280,maxRestoreHeight:800,devicePixelRatio:1,revisionSha256:"41b47f3af2adc536df77a91dcd2918aa527c6343b3b75c31c319b8a0aafe34b8",artworkRevisionId:"3fb6bc87-4c8d-4b51-b964-8db4a23afd0b",sourceBindingSha256:"71788419a2d293776411c7ec01eae65333e80853c59c05a151a646ced2c6c9a8",featureReportSha256:"1a2d0b23a7746598aba2a18939001d819c759560bf42a6e54aba5a7363f6e836",inspector:"sharp-0.35.4-vips-8.18.6-mozjpeg-0826579",model:"wheat-m1-chrome156-private-384-v1",detailViewport:Object.freeze({"width":692,"height":520,"canvasWidth":692,"canvasHeight":520,"pixelRatio":1,"devicePixelRatio":1}),runtime:Object.freeze({"renderer":"ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)","platform":"macOS","browserBrand":"Google Chrome","browserVersion":"156.0.8078.79","samples":4,"alpha":true,"depth":true,"antialias":true,"preserveDrawingBuffer":true})});
// The same original and measured image cost in the exact Hayes r6 publication.
// Its larger scene is a separate bounded device/viewport qualification.
const hayesWheat:QualifiedDetailImage=Object.freeze({...measuredWheat,
 staticIndexSha256:'8f58935dd614adbfa231b083552c1af188fc8ce10984fdddf97d7b9f716718a2',
 publicationSha256:'6c768eccdfd63868a48fd2e4d252774e1ea4d96e3fe401fa09038efee468a1af',
 candidateId:'215dc6fe-9b03-4f69-923d-c1922ed3a492',
 revisionSha256:'66595ef205a030ba360791fe75b970e9a4a536e5d4e1cf37505c49bc96f91648',
 artworkRevisionId:'0316fa47-149c-43b8-942b-95280fd0052e',
 sourceBindingSha256:'74efc39a79e65072d11cf0f75bdd7fae55c0875a84377820e19fb005cb4995b4',
 maxSceneBytes:167772160,transitionCapBytes:603979776,
});
// Exact r7 Manager publication of the same qualified original; admission still
// requires the measured runtime, viewport, cover retirement and live authority.
const hayesR7Wheat:QualifiedDetailImage=Object.freeze({...hayesWheat,
 maxSceneBytes:201326592,
 staticIndexSha256:'c998f166a7e543c6d71157648a146c34686a59a4d71a42bf2625a7ac76d26f44',
 publicationSha256:'cd8fd26f8d73024d009394ba468eedad0c08988f30e9f5c0f44d4782c673f935',
 candidateId:'68257123-c1fb-426b-93c8-b96e94dc50e5',
 revisionSha256:'ab2e073f1b74b1989f362d35578b53c5854b8d5654c058ae81cfa0fc6ed3fd88',
 artworkRevisionId:'260c29fe-17aa-4c97-bdb5-076b46b3094b',
 sourceBindingSha256:'f7a63b3aa7e67a7f39dead22babd2d21584b48d100f1237ca2b4a9901de75ca7',
});
// The r9 Aristotle update retains the exact Wheat original and cost report.
export const aristotleR9Wheat:QualifiedDetailImage=Object.freeze({...hayesR7Wheat,
 staticIndexSha256:'792bcc90a401d6e0f71dcb4f880690d8775fd40be17ab376a41a0dd66875ec0d',
 publicationSha256:'97218ceeb2fed0a246395e560b395578c33965acc9ee00cde8f8bc5bf8911dde',
 candidateId:'fd1cc5fc-7bbb-4f49-9657-cb5ff0c51dcc',
 revisionSha256:'99ef3623900d27f047a1f1e12d213ce753fe3bd6ca85599eb4328171a32b7c19',
 artworkRevisionId:'5c293150-dfd7-4aa6-940b-1d61989ada7d',
 sourceBindingSha256:'55368a3b4aaf529973603bc414b3668d615458ff655b848793e2b0f99cab905c',
});
// This exact successor retains the independently measured source and cover bytes.
export const wingedR12Wheat:QualifiedDetailImage=Object.freeze({...aristotleR9Wheat,
 staticIndexSha256:'50888213fc0ccbf37164ff0a1b14fc21c7bb8443aaab4a292e211efaae97a726',
 publicationSha256:'f66ff2b453125df5a6a69c3b893f0c9ca46b752d743a753943b4e0a16ec75e7b',
 candidateId:'725097fe-56b5-4fb6-9a21-05170171fd0a',
 revisionSha256:'1b9cbad79b1e561b82a56b236cabc9c270500406bb40966b62636e018985748d',
 artworkRevisionId:'842a5114-b169-4046-a653-3e7dbbaf8bc9',
 sourceBindingSha256:'fa7aa858d24c96f814669c5211872f48e6f25bb7197df907f0c6f6906b7c410b',
});
// The r19 painting update rebinds the same measured original to its exact publication.
const r19Wheat:QualifiedDetailImage=Object.freeze({...wingedR12Wheat,
 staticIndexSha256:'af7e1967477a9b1d247da21bc27b894561c74da1f0d2614b7b29443fa4975d5d',
 publicationSha256:'009511e3133cc8c89ca0237cb55fed0043df9967dc7f0914c4fe165653f74aff',
 candidateId:'bbd79da8-830c-4356-bf49-af131de40ba6',
 revisionSha256:'be7e7511319007e510e24a511acb709d52d45417f9378ff50508464dce54ffbe',
 artworkRevisionId:'9e775fc4-a06b-43e6-a561-e65d31127197',
 sourceBindingSha256:'491a245e8606dc666ecdf9df575102d146d49d95cb6da0ca6cd03b3176aca0eb',
});
const r20Wheat:QualifiedDetailImage=Object.freeze({...r19Wheat,
 staticIndexSha256:'054b6756a6aa468e25eaa634b84800fb01d3b21d11f0fff6075f5d54291e8d68',
 publicationSha256:'b1f966765930533fd4ee649ca33961fea8db6a132ad3ce3ea95e5bb74d57a547',
 candidateId:'af6bd1f4-cc9b-4cee-bb0c-cdfc1626173f',
 revisionSha256:'6936b3910f1ed1b55b3193f8432d178080e5a9fe7d6217e741f345c83dde68f3',
 artworkRevisionId:'9ce499d3-6a94-48eb-b1f1-512f138872b7',
 sourceBindingSha256:'726560b067ad9942ed1fcfeeb6c0029b4bce570da94098e731ddbd32eba0523b',
});
const r21Wheat:QualifiedDetailImage=Object.freeze({...r20Wheat,
 staticIndexSha256:'5664e9e067b68854760097b03c527dd7653e5a2819075bff794a9cc8a6cc0e7b',
 publicationSha256:'49421cbc69c017f5811039a0ba43b58adf00704de70156a2d2347ad0cb18c580',
 candidateId:'ce3f1da0-dc01-4921-8bc0-75640ac13969',
 revisionSha256:'585d9e49d84aeb89fc992cb9ffe48543caa321c311260d8f73865c70d7ec0d48',
 artworkRevisionId:'75450bac-6b51-45ce-ba6b-7e501b68a340',
 sourceBindingSha256:'c1103601c93be343acd04ff878ebdbab96ac6addddb1b159916472eb0c5f73a9',
});
const r22Wheat:QualifiedDetailImage=Object.freeze({...r21Wheat,
 staticIndexSha256:'04033f1f69797b1e6dc0ac39dfb5b0d30dae20df58b74968f0c9e6601543a3b0',
 publicationSha256:'2b3b595067e1a85084bab2148a04aa77851ab887b8ec010b03887f03e7c98d41',
 candidateId:'e0149040-ee18-4ec2-b2e6-945e82f83239',
 revisionSha256:'bc58417d00d6c8a07062032ed8f181a4a770640bbd2faa754cc268a2249b48ba',
 artworkRevisionId:'f34e0f81-fb80-4ee1-a1fe-82ce43ae52a1',
 sourceBindingSha256:'df8bef03cf46319723cdfd6800c09cd53dbdad0121498a62921c2e00384aa114',
});
const r23Wheat:QualifiedDetailImage=Object.freeze({...r22Wheat,
 staticIndexSha256:'7fbb7f2e5ec8a14b55f1c10c52d1c0ddce1d9c2fedb8beb85e5c38b636bae0ed',
 publicationSha256:'f7aa68f6b16f90c837fb7fe9b62d850d232063ab579b08a8b935f7c7b5b0f6ba',
 candidateId:'de6908dd-39e9-4dc4-ba85-7a206a39278a',
 revisionSha256:'971bae6d2bd7bac044f4a80c578021571136e68432f95dc1472fa57e73afe8bc',
 artworkRevisionId:'0e80073c-663f-4c68-8643-fed9dde4af05',
 sourceBindingSha256:'c8e5c7e4aba21aa00e0cfe13cf2e81b2dee1e0de2678e167e56874d98b125dea',
});
const r24Wheat:QualifiedDetailImage=Object.freeze({...r23Wheat,
 staticIndexSha256:'204169b08b240cc9c4bbae9b14e190ae6c47adff58517182be12fd01b8a66e3f',
 publicationSha256:'6b039f2e128badd5ae82e4657f56255a1e2e1a65ea9fc3b6d376d4b94a68851a',
 candidateId:'4d8911f0-75b9-4f0a-909c-cbdc8de3c32e',
 revisionSha256:'dcb2a94f4539bd79ac37eae15c66cff9cc1f854808cc7c7306e593474156db3f',
 artworkRevisionId:'5f5dd323-e397-4439-a755-fc01f8ccf4da',
 sourceBindingSha256:'7c1823bbb862fd7579a2307ae15920dc055bc48ca869357dd8abcdea540515c9',
});
const r26Wheat:QualifiedDetailImage=Object.freeze({...r24Wheat,
 staticIndexSha256:'f65395808f6bc8c75f7b687680e7e881b57ad1f1f75499bae2c81ebbc6bf4fd5',
 publicationSha256:'ea678b4e7360da964c54beade26e00f90bbfc1183e0c534dbcf734a1d2b48a1c',
 candidateId:'752f243b-c5c1-47e1-8124-1f54f7d04299',
 revisionSha256:'eb9c9e286a86092dec5b665da742a6bfad95c31445474630907cdcdafefcf7b1',
 artworkRevisionId:'6b4cdca1-06cd-45bd-a8b7-0c6a37bd1c7e',
 sourceBindingSha256:'0a7fc74cba62768fed6ea510f835b1cdb0c8a15feed9e67e24be58aace6e3ae9',
});
const r27Wheat:QualifiedDetailImage=Object.freeze({...r26Wheat,
 staticIndexSha256:'2d86b16e1e3a0a2afc266d04341edca688fba6679b1036792d6457728c9a4989',
 publicationSha256:'0ac0efd992d8728a642941ac90b722daee16a6e3f01c8c202f1c96b20f867651',
 candidateId:'ee5a4365-509e-44f1-8495-30bc5f534eca',
 revisionSha256:'387331410ee5516d0e7a3811534487ad8d28b293eaba330925dc19c47928cf49',
 artworkRevisionId:'9080ee2c-13aa-4ad6-a1c0-26e7b6cfde5f',
 sourceBindingSha256:'f2a4da732fb57487f1f63d13c3610db743f0de9ac1b77ede73b356faa9417849',
});
const r41Wheat:QualifiedDetailImage=Object.freeze({...r27Wheat,
 staticIndexSha256:'7930f6832341fa943b16820787febd84bc63138179583fe6d2a675cef84da189',
 publicationSha256:'7cb41e36c27978ff33110236c7f4754d605e6f7fc112c84f1b093e5407c22588',
 candidateId:'0cc51666-c6b6-4388-a0ab-6cb799defbf2',
 revisionSha256:'d00bfcfb4505e908260a153115a1051c5bdd2cd6438f9bb52c28ff331ecf26b8',
 artworkRevisionId:'39739b23-1061-4100-a45c-f2ca3c8ef8cc',
 sourceBindingSha256:'311fa91578bb4fb591187d5b0452b15c856ea8e8b3313e939b23a860f81e5aea',
});
const r44Wheat:QualifiedDetailImage=Object.freeze({...r41Wheat,
 staticIndexSha256:'866fd62a1ca3babb0f150e8895ce4255cd5c72b0059574f1de3033a8515fd880',
 publicationSha256:'8d864e782fffdd088a066319b29cb364fc9a2fb52758185ee98e2730524b6f29',
 candidateId:'0c3964cb-a8b5-4ee2-afd1-d71cab99ccd7',
 revisionSha256:'5eb75fc9fcae3fbd6a322634772f25d6d4400c6cd9fdc9c31e2c902f74602e5f',
 artworkRevisionId:'8f1c52ac-9dfe-4cd7-8e66-357357c5cdc0',
 sourceBindingSha256:'a101518bc38bf668302d4078aca9ae06b548568ef720c85024054708a3c90f88',
});
// The r46 exit-door publication retains the measured Wheat original and its bounds.
const r46Wheat:QualifiedDetailImage=Object.freeze({...r44Wheat,
 staticIndexSha256:'c3b6ba70e888a20416e40f34a99c328134c122e423b499f3682b0ea896cac17e',
 publicationSha256:'474763f2b2f46b2877f6cd176fcd1351108c4220ba5423c85f08c8c6eb48a2c2',
 candidateId:'721829fe-5efc-4024-9d41-293653b11f07',
 revisionSha256:'02420a0e67800e3d957734414f92d99b977c9534172cbd613a8c0ef30f50bd15',
 artworkRevisionId:'157793b9-2f6c-41d4-8688-686b30554a58',
 sourceBindingSha256:'11580deb7affa3a3f90843abe6c354f34f9ce5dbd4a85e7f7244e7c443806e3d',
});
// The r52 painting placement update retains the measured Wheat original and its bounds.
const r52Wheat:QualifiedDetailImage=Object.freeze({...r46Wheat,
 staticIndexSha256:'eae9524c7d1c1232012b9c3a6d1612288485fa51260a369597802e1c7f3c0b8a',
 publicationSha256:'8685c98477ec9bda7316e98469726734cfe67f7f54a5431c2cea24ce26e34cfc',
 candidateId:'e91105a5-eb67-4e17-b30a-8791f330ce4b',
 revisionSha256:'abdf3ca07a33d9ad2a9c63a46b640ac2f6b9cac763ba3f19ed57d73c57a25292',
 artworkRevisionId:'d7709511-4d09-4c4f-a08c-1c75888b3b0e',
 sourceBindingSha256:'f14745bc517812c3f0ce50084e6ab64a1d07f490fc20fad8117ed0060c9a02ab',
});
// The r53 Arrival text update retains the measured Wheat original and its bounds.
const r53Wheat:QualifiedDetailImage=Object.freeze({...r52Wheat,
 staticIndexSha256:'79541417f1248a4c335c72cdaf9a84906f4558d261782cf0107266bb8f60ce2e',
 publicationSha256:'cdef470d858b51723ae5598e4a648df04a4bdd5ef91f8eaa24fe2ed461ba6de3',
 candidateId:'0e338503-daec-43a8-bdab-862a2a632180',
 revisionSha256:'bb4a21f1fa4d5e8a0bc64885b08c06f2a72a346a5a43da86aa81a68583451322',
 artworkRevisionId:'6b1cd4e6-2afc-4766-8776-fb553d3b90bd',
 sourceBindingSha256:'52b6a986cd5996358a96a0c6cf3a1e7ad70e4afe05d4d3d411293535515367a8',
});
// The r57 north wall update retains the measured Wheat original and its bounds.
const r57Wheat:QualifiedDetailImage=Object.freeze({...r53Wheat,
 staticIndexSha256:'9ee1a6f7a93288870f130ed2daa0b873bb445fc20192adfd53a1ba1c768141f1',
 publicationSha256:'e99ce99bb99af338430c1f530494a6abac3891d5fae2dd61c5363b7818cd1a6e',
 candidateId:'f1782724-50f7-4948-b8c2-e4db2bc16c93',
 revisionSha256:'a680f167663d42f850e363bab6b2675745c01f8ca527752a281ce2df5d56cc2f',
 artworkRevisionId:'85d22710-0854-4970-8d7a-86b8d105ff68',
 sourceBindingSha256:'79cde206bbabcc29417df6e963ae14b12900361d0763c31e10672d63d0582b07',
});
// The r61 sculpture update retains the measured Wheat original and its bounds.
const r61Wheat:QualifiedDetailImage=Object.freeze({...r57Wheat,
 staticIndexSha256:'f1da47677f16089aa2d330b1e817a059f2d05f6e853e2f4875dfb34bcb75ecbc',
 publicationSha256:'f5938db6d5ac55f3dc2b440e8188ca267247c31938ac73ee0bebbbefe0ea694c',
 candidateId:'5aabeb35-5cbb-464e-9fe7-a9af20190cdf',
 revisionSha256:'6635e00acf0abd2b6ef1655fba447cdd0957847686ba179d20cfc1c5575a7306',
 artworkRevisionId:'0ec663d4-55ab-4c47-bed6-f5bab981e50c',
 sourceBindingSha256:'5480d535e23b1a4c283b933686582778003df04f270d95d9d0af624a1bed0a67',
});
const qualifiedWheatProfiles=Object.freeze([measuredWheat,hayesWheat,hayesR7Wheat,aristotleR9Wheat,wingedR12Wheat,r19Wheat,r20Wheat,r21Wheat,r22Wheat,r23Wheat,r24Wheat,r26Wheat,r27Wheat,r41Wheat,r44Wheat,r46Wheat,r52Wheat,r53Wheat,r57Wheat,r61Wheat]);
export function qualifiedDetailImageProfile(revisionSha256?:string,artworkRevisionId?:string):QualifiedDetailImage|undefined{return qualifiedWheatProfiles.find(profile=>revisionSha256===profile.revisionSha256&&artworkRevisionId===profile.artworkRevisionId);}
export function hasQualifiedWheatRevision(revisionSha256?:string):boolean{return qualifiedWheatProfiles.some(profile=>revisionSha256===profile.revisionSha256);}
export function createDetailImageSlot():DetailImageSlot{return createDetailAttemptSlot<DetailImageResource>();}
export interface DetailImageViewport {width:number;height:number;canvasWidth:number;canvasHeight:number;pixelRatio:number;devicePixelRatio:number}
/** A measured profile cannot survive an unmeasured canvas or DPR change. */
export function sameDetailImageViewport(a:DetailImageViewport,b:DetailImageViewport){return Number.isSafeInteger(a.width)&&a.width>0&&Number.isSafeInteger(a.height)&&a.height>0&&Number.isSafeInteger(a.canvasWidth)&&a.canvasWidth>0&&Number.isSafeInteger(a.canvasHeight)&&a.canvasHeight>0&&Number.isFinite(a.pixelRatio)&&a.pixelRatio>0&&Number.isFinite(a.devicePixelRatio)&&a.devicePixelRatio>0&&a.width===b.width&&a.height===b.height&&a.canvasWidth===b.canvasWidth&&a.canvasHeight===b.canvasHeight&&a.pixelRatio===b.pixelRatio&&a.devicePixelRatio===b.devicePixelRatio;}


/** Reserve a session-owned image against the existing gallery peak ledger.
 * The owner keeps that reservation through display and positive drain; this
 * does not transfer the candidate into the ordinary gallery cache. */
export function startDetailImageAttempt(input:{
 profile:QualifiedDetailImage;access:DetailAccess;slot:DetailImageSlot;peak:AssetPeakBudget;limit:number;
 attemptId:string;generation:number;isCurrent:(generation:number)=>boolean;signal:AbortSignal;three:typeof Three;
 progress?:(loadedBytes:number)=>void;
 /** Must check the exact loader-owned publication and capability identities. */
 isTrusted:()=>boolean;
 /** Transfer the still-charged hold synchronously to the canvas-restoration owner. */
 handoffReservation?:(key:string,bytes:number)=>boolean;
 /** The scope owns the borrowed view; neither callback may free gallery assets. */
 draw:(object:Three.Object3D)=>void;hide:()=>void;
 /** Configuration-specific command-completion check, not physical reclamation. */
 completeCommands:()=>Promise<void>;
}){
 // Only call with the actual verified static loader capability, never an
 // arbitrary adapter: its typed failure covers that call's owned read only.
 const {access,slot,peak,attemptId,generation}=input;const profile=Object.freeze({...input.profile,detailViewport:Object.freeze({...input.profile.detailViewport}),runtime:Object.freeze({...input.profile.runtime})});
 const trusted=()=>{try{return input.isTrusted()===true;}catch{return false;}};
 if(!(input.signal instanceof AbortSignal)||!trusted()||input.signal.aborted||access.revisionSha256!==profile.revisionSha256||!Number.isSafeInteger(profile.bytes)||profile.bytes<1||profile.bytes>33554432||!/^([a-f0-9]{64})$/.test(profile.sha256)||(profile.mime!=='image/jpeg'&&profile.mime!=='image/png')||!Number.isSafeInteger(profile.reservationBytes)||profile.reservationBytes<1||!Number.isSafeInteger(profile.restoreReservationBytes)||profile.restoreReservationBytes<1||profile.restoreReservationBytes>profile.reservationBytes||!Number.isSafeInteger(profile.maxRestoreWidth)||profile.maxRestoreWidth<1||!Number.isSafeInteger(profile.maxRestoreHeight)||profile.maxRestoreHeight<1||!Number.isFinite(profile.devicePixelRatio)||profile.devicePixelRatio<=0||!sameDetailImageViewport(profile.detailViewport,profile.detailViewport)||profile.detailViewport.devicePixelRatio!==profile.devicePixelRatio||!Number.isSafeInteger(profile.transitionCapBytes)||profile.transitionCapBytes<1||!Number.isSafeInteger(profile.maxSceneBytes)||profile.maxSceneBytes<1||!Number.isSafeInteger(profile.maxSceneBytes+profile.reservationBytes)||profile.maxSceneBytes+profile.reservationBytes>profile.transitionCapBytes||!Number.isSafeInteger(profile.maxSceneBytes+profile.restoreReservationBytes)||profile.maxSceneBytes+profile.restoreReservationBytes>profile.transitionCapBytes||!Number.isSafeInteger(profile.width)||profile.width<1||profile.width>8192||!Number.isSafeInteger(profile.height)||profile.height<1||profile.height>8192||profile.reservationBytes<profile.width*profile.height*4||!input.isCurrent(generation))throw Error('DETAIL_IMAGE_ADMISSION_INVALID');
 // reserve is synchronous with slot start; if the slot refuses, immediately
 // return this not-yet-used hold. No byte reader or decoder exists at this point.
 slot.assertAvailable(attemptId,generation);const current=peak.total(),requested=profile.reservationBytes,cap=Math.min(input.limit,profile.transitionCapBytes);if(!Number.isSafeInteger(current)||current<0||!Number.isSafeInteger(cap)||cap<1||!Number.isSafeInteger(current+requested))throw Error('DETAIL_IMAGE_ADMISSION_INVALID');if(current>profile.maxSceneBytes||current+requested>cap){slot.assertAvailable(attemptId,generation);if(input.signal.aborted||!input.isCurrent(generation))throw Error('DETAIL_IMAGE_ADMISSION_INVALID');throw new DetailImageBudgetRefusal(attemptId,generation,requested,current,cap,profile.maxSceneBytes);}const key=`detail-image:${crypto.randomUUID()}`;peak.reserve(key,requested,cap);
 const uncertainRead=(error:unknown)=>!(trusted()&&error instanceof DetailAccessFailure&&error.retirement==='confirmed');
 let cleanupFailed=false,hideFailed=false,drawEntered=false,revalidationStarted=false,resource:DetailImageResource|undefined,revalidation:Promise<void>|undefined,pendingRecheck:Promise<void>|undefined;const ownerAbort=new AbortController();
 const disposeParts=(parts:{texture?:Three.Texture;material?:Three.MeshBasicMaterial;geometry?:Three.PlaneGeometry;bitmap?:ImageBitmap})=>{
  let failed=false;for(const dispose of [()=>parts.texture?.dispose(),()=>parts.material?.dispose(),()=>parts.geometry?.dispose(),()=>parts.bitmap?.close()])try{dispose();}catch{failed=true;}
  if(failed){cleanupFailed=true;throw Error('DETAIL_IMAGE_CLEANUP_UNCERTAIN');}
 };
 const releasePartial=()=>{if(!resource)return;const owned=resource;resource=undefined;disposeParts(owned);};
 let attempt:ReturnType<DetailImageSlot['start']>;
 try{attempt=slot.start({attemptId,generation,isCurrent:input.isCurrent,
  async run(attemptSignal){
   const signal=AbortSignal.any([attemptSignal,ownerAbort.signal]);
   let bitmap:ImageBitmap|undefined,texture:Three.Texture|undefined,geometry:Three.PlaneGeometry|undefined,material:Three.MeshBasicMaterial|undefined;
   try{
    let candidates:Awaited<ReturnType<DetailAccess['candidatesFor']>>;try{candidates=await access.candidatesFor(profile.artworkRevisionId,signal);}catch(error){if(uncertainRead(error))cleanupFailed=true;throw error;}signal.throwIfAborted();if(!trusted())throw Error('DETAIL_IMAGE_AUTHORITY');const candidate=candidates.find(value=>value.candidateId===profile.candidateId),media=candidate?.featureReport.media;if(!candidate||candidate.tier!=='acquired-original'||candidate.sha256!==profile.sha256||candidate.bytes!==profile.bytes||candidate.mime!==profile.mime||candidate.sourceBindingSha256!==profile.sourceBindingSha256||candidate.featureReportSha256!==profile.featureReportSha256||candidate.featureReport.inspector!==profile.inspector||candidate.featureReport.cost.model!==profile.model||!Number.isSafeInteger(candidate.featureReport.cost.peakAdditionalBytes)||candidate.featureReport.cost.peakAdditionalBytes>profile.reservationBytes||media?.kind!=='image'||media.width!==profile.width||media.height!==profile.height)throw Error('DETAIL_IMAGE_BINDING');let bytes:Uint8Array;try{await access.recheck(profile.candidateId,signal);bytes=await access.fetch(profile.candidateId,signal,input.progress);}catch(error){if(uncertainRead(error))cleanupFailed=true;throw error;}signal.throwIfAborted();if(!trusted())throw Error('DETAIL_IMAGE_AUTHORITY');
    if(bytes.byteLength!==profile.bytes)throw Error('DETAIL_IMAGE_INTEGRITY');
    const snapshot=new Uint8Array(bytes);const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',snapshot))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==profile.sha256)throw Error('DETAIL_IMAGE_INTEGRITY');signal.throwIfAborted();
    const decoded=await createImageBitmap(new Blob([snapshot],{type:profile.mime}),{imageOrientation:'flipY',colorSpaceConversion:'default'});bitmap=decoded;
    signal.throwIfAborted();if(decoded.width!==profile.width||decoded.height!==profile.height)throw Error('DETAIL_IMAGE_INTEGRITY');
    texture=new input.three.Texture(decoded);texture.colorSpace=input.three.SRGBColorSpace;texture.generateMipmaps=true;texture.minFilter=input.three.LinearMipmapLinearFilter;texture.needsUpdate=true;
    geometry=new input.three.PlaneGeometry(1,1);material=new input.three.MeshBasicMaterial({map:texture});
    const value:DetailImageResource={bitmap:decoded,texture,geometry,material,object:new input.three.Mesh(geometry,material)};resource=value;bitmap=undefined;texture=undefined;geometry=undefined;material=undefined;
    return {ownership:'owned' as const,value};
   }catch(error){disposeParts({bitmap,texture,geometry,material});throw error;}
  },
  async disposeOwned(){releasePartial();await input.completeCommands();if(cleanupFailed)throw Error('DETAIL_IMAGE_CLEANUP_UNCERTAIN');},
  async releaseBorrow(){throw Error('DETAIL_IMAGE_OWNERSHIP');},
  async drainChildren(){if(revalidation)try{await revalidation;}catch(error){if(revalidationStarted&&uncertainRead(error))cleanupFailed=true;}if(hideFailed&&drawEntered||cleanupFailed&&!resource)throw Error('DETAIL_IMAGE_CLEANUP_UNCERTAIN');},
  async releaseReservation(){if(input.handoffReservation?.(key,profile.reservationBytes)===true)return;peak.release(key);},
 });}catch(error){peak.release(key);throw error;}
 let closing=false;const close=()=>{if(!closing){closing=true;try{input.hide();}catch{hideFailed=true;cleanupFailed=true;}ownerAbort.abort();}input.signal.removeEventListener('abort',onAbort);return attempt.drain();};const onAbort=()=>{void close().catch(()=>{});};input.signal.addEventListener('abort',onAbort,{once:true});if(input.signal.aborted)onAbort();
 const checkSource=()=>{
  if(pendingRecheck)return pendingRecheck;
  // The deadline hides immediately even if a broken reader ignores abort;
  // drain still awaits actual settlement and retains the reservation meanwhile.
  const deadline=setTimeout(()=>{void close().catch(()=>{});},5000);
  const task=Promise.resolve().then(()=>{ownerAbort.signal.throwIfAborted();revalidationStarted=true;return access.recheck(profile.candidateId,ownerAbort.signal);});
  revalidation=task;pendingRecheck=task;void task.then(()=>{clearTimeout(deadline);if(pendingRecheck===task)pendingRecheck=undefined;},()=>{clearTimeout(deadline);if(pendingRecheck===task)pendingRecheck=undefined;});return task;
 };
 let shown=false,showing=false;
 return {async recheck(){try{if(closing||!shown||!attempt.canPublish()||!trusted())throw Error('DETAIL_IMAGE_AUTHORITY');await checkSource();if(!attempt.canPublish()||!trusted()||closing)throw Error('DETAIL_IMAGE_AUTHORITY');}catch(error){void close().catch(()=>{});throw error;}},async show(){if(shown||showing){if(!input.isCurrent(generation)||input.signal.aborted)void close().catch(()=>{});return false;}showing=true;try{let staged:DetailImageResource|undefined;const prepared=await attempt.tryCommit(value=>{staged=value;return true;});if(!prepared||!staged||closing){if(!input.isCurrent(generation)||input.signal.aborted)void close().catch(()=>{});return false;}
   await checkSource();
   if(!trusted())throw Error('DETAIL_IMAGE_AUTHORITY');if(!attempt.canPublish()||input.signal.aborted||closing){void close().catch(()=>{});return false;}
   drawEntered=true;input.draw(staged.object);if(!attempt.canPublish()||input.signal.aborted||closing){void close().catch(()=>{});return false;}shown=true;return true;
  }catch(error){void close().catch(()=>{});throw error;}finally{showing=false;}
  },close};
}
