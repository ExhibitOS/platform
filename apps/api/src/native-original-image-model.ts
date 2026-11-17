// SPDX-License-Identifier: AGPL-3.0-or-later
// PRIVATE QUALIFICATION CANDIDATE ONLY: exact measured Wheat file and owner.
import type {NativeDetailContext} from './native-detail-context.ts';
import type {Session} from './auth.ts';
import {matchesPrivateWheatOwner} from './private-wheat-candidate-pin.ts';
export function hasQualifiedOriginalImageModel(context?:NativeDetailContext,s?:Session,exhibitionId?:string):boolean{return !!context&&!!s&&typeof exhibitionId==='string'&&matchesPrivateWheatOwner(context,s,exhibitionId);}
type ImageModelInput={sha256:string;bytes:number;width:number;height:number;iccSha256:string|null};

/** Conservative envelope based on the existing decoder reservation. Viewer
 * admission still belongs to its independently measured projection. */
export function ownerLocalOriginalImageModel(input:ImageModelInput){
 if(input.bytes<1||input.bytes>8*1024*1024||input.width<1||input.width>4000||input.height<1||input.height>4000||input.width*input.height>12800000||!input.iccSha256)return undefined;
 return {model:'native-baseline-icc-jpeg-384-v1',residentBytes:163942340,peakAdditionalBytes:402653184};
}

export function qualifiedOriginalImageModel(input:ImageModelInput):{model:string;residentBytes:number;peakAdditionalBytes:number}|undefined{
 if(input.sha256!=='b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d'||input.bytes!==8291194||input.width!==4000||input.height!==3184||input.iccSha256!=='f6bd2776ef85c5a0a9313989eb60f3db7996bc4af48453353f53840643d8e32b')return undefined;
 // Modeled visible/recheck component; the entire 384 MiB hold remains charged.
 return {model:'wheat-m1-chrome156-private-384-v1',residentBytes:163942340,peakAdditionalBytes:402653184};
}
