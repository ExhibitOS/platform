// SPDX-License-Identifier: AGPL-3.0-or-later
/** Optional display treatment, independent of rights and original access. */
export interface DisplayWatermark {
 version:1;mode:'none'|'overlay'|'embedded';text?:string;
 position?:'top-left'|'top-right'|'bottom-left'|'bottom-right';size?:number;opacity?:number;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const DEFAULT_WATERMARK:Readonly<DisplayWatermark>=Object.freeze({version:1,mode:'none'});
export function validDisplayWatermark(v:unknown):v is DisplayWatermark{
 if(!object(v)||v.version!==1||typeof v.mode!=='string'||!['none','overlay','embedded'].includes(v.mode)||Object.keys(v).some(k=>!['version','mode','text','position','size','opacity'].includes(k)))return false;
 // Reject raw C0/C1 controls before trimming; these ranges are intentional.
 // eslint-disable-next-line no-control-regex
 return (v.text===undefined||typeof v.text==='string'&&v.text.trim().length>0&&Array.from(v.text).length<=160&&!/[\u0000-\u001f\u007f-\u009f]/.test(v.text))&&
  (v.position===undefined||typeof v.position==='string'&&['top-left','top-right','bottom-left','bottom-right'].includes(v.position))&&
  (v.size===undefined||typeof v.size==='number'&&Number.isInteger(v.size)&&v.size>=8&&v.size<=24)&&
  (v.opacity===undefined||typeof v.opacity==='number'&&Number.isFinite(v.opacity)&&v.opacity>=.1&&v.opacity<=.6);
}
export function normalizeDisplayWatermark(value:unknown):DisplayWatermark{
 if(value===undefined)return {...DEFAULT_WATERMARK};
 if(!validDisplayWatermark(value))throw Error('DISPLAY_WATERMARK_INVALID');
 if(value.mode==='none')return {...DEFAULT_WATERMARK};
 return {version:1,mode:value.mode,...(value.text===undefined?{}:{text:value.text.trim()}),position:value.position??'bottom-right',size:value.size??12,opacity:value.opacity??.25};
}
export function watermarkFor(candidate:{extensions?:unknown}):DisplayWatermark{
 const presentation=object(candidate.extensions)?candidate.extensions['org.exhibitos.studio/presentation']:undefined;
 return normalizeDisplayWatermark(object(presentation)?presentation.watermark:undefined);
}
/** A small bounded Latin label, not a multilingual font/rasterization promise. */
export function embeddedWatermarkTextSupported(text:string){return text.length>0&&text.length<=80&&/^[A-Za-z0-9 .,:;!?"'_/@()+-]+$/.test(text);}
export const WATERMARK_CAPABILITIES=Object.freeze({overlay:true,embeddedPng:true,embeddedGlb:false});
export function watermarkLabel(candidate:{title?:string;extensions?:unknown}):string{
 const settings=watermarkFor(candidate);if(settings.text)return settings.text;
 if(settings.mode==='embedded')return 'EXHIBITOS';
 const entrance=object(candidate.extensions)?candidate.extensions['org.exhibitos.viewer/entrance']:undefined;
 const artist=object(entrance)&&typeof entrance.artist==='string'?entrance.artist.trim():'';
 return Array.from([candidate.title?.trim(),artist].filter(Boolean).join(' · ')).slice(0,160).join('')||'ExhibitOS';
}
