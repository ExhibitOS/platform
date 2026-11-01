// SPDX-License-Identifier: AGPL-3.0-or-later
/** A pending camera applies only to one exact public source in this tab. */
export function privateViewKey(publicationId:string,revision:string,index:string){
 if(!/^[0-9a-f-]{36}$/i.test(publicationId)||! /^[a-f0-9]{64}$/.test(revision)||! /^[a-f0-9]{64}$/.test(index))return;
 return `exhibitos-private-view-v1:${publicationId}:${revision}:${index}`;
}
export function discardPrivateView(publicationId:string,revision:string,index:string){
 const key=privateViewKey(publicationId,revision,index);if(!key)return;
 try{sessionStorage.removeItem(key);}catch{/* Storage is optional. */}
}
