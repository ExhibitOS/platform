// SPDX-License-Identifier: AGPL-3.0-or-later
/** Rights are rechecked at load and before every use of a static copy. */
export function publicWorkspaceFurnishingRights(extension,now=Date.now()){
 if(extension===undefined)return true;
 if(!extension||!Array.isArray(extension.furnishings)||!Number.isFinite(now))return false;
 const time=value=>{if(value===undefined)return undefined;if(typeof value!=='string')return NaN;const parsed=Date.parse(value),canonical=value.replace(/(?:\.(\d{1,3}))?Z$/,(_all,ms)=>`.${(ms??'').padEnd(3,'0')}Z`);return Number.isFinite(parsed)&&new Date(parsed).toISOString()===canonical?parsed:NaN;};
 return extension.furnishings.every(item=>{const rights=item?.rights,permissions=rights?.permissions,from=time(rights?.validFrom),until=time(rights?.expiresAt);return !!rights&&permissions?.display===true&&permissions?.export===true&&!Number.isNaN(from)&&!Number.isNaN(until)&&(from??-Infinity)<(until??Infinity)&&now>=(from??-Infinity)&&now<(until??Infinity);});
}
