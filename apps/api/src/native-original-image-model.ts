// SPDX-License-Identifier: AGPL-3.0-or-later
/** Server-owned admission registry. No browser/device image model is qualified
 * for publication yet. A measured profile must be independently reviewed and
 * implemented here before the native original producer can publish. */
export function hasQualifiedOriginalImageModel():boolean{return false;}
export function qualifiedOriginalImageModel(_input:{sha256:string;bytes:number;width:number;height:number;iccSha256:string|null}):{model:string;residentBytes:number;peakAdditionalBytes:number}|undefined{return undefined;}
