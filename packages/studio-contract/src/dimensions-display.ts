// SPDX-License-Identifier: AGPL-3.0-or-later
/** DISPLAY ONLY. Inputs are stored metres; no artwork, placement or export is changed. */
export type DimensionDisplayUnit = 'cm' | 'mm' | 'm';
export interface DimensionDisplayOptions { unit?: DimensionDisplayUnit; precisionMeters?: number }
const NONE='크기 정보 없음';
const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const factor:Record<DimensionDisplayUnit,number>={cm:100,mm:1000,m:1};
const number=(v:number)=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1,useGrouping:false}).format(v);
export function formatLength(meters:unknown,options:DimensionDisplayOptions={}):string {
 if(!valid(meters))return NONE;
 let unit=options.unit??'cm';
 // A preferred unit stays authoritative; tiny default values can use mm.
 if(options.unit===undefined&&meters*100<.1)unit='mm';
 const value=meters*factor[unit];if(!valid(value))return NONE;
 const convertedPrecision=valid(options.precisionMeters)?options.precisionMeters*factor[unit]:0;
 const precision=valid(convertedPrecision)?convertedPrecision:0;
 const step=Math.max(.1,precision);
 const rounded=precision>.1?Math.round(value/precision)*precision:Math.round(value*10)/10;
 if(!Number.isFinite(rounded))return NONE;
 if(rounded===0)return `${number(step)} ${unit} 미만`;
 return `${number(rounded)} ${unit}`;
}
export function formatArtworkDimensions(dimensions:unknown,options:DimensionDisplayOptions&{includeDepth?:boolean}={}):string {
 if(!dimensions||typeof dimensions!=='object'||Array.isArray(dimensions))return NONE;
 const d=dimensions as {width?:unknown;height?:unknown;depth?:unknown};
 if(!valid(d.width)||!valid(d.height))return NONE;
 const parts=[`너비 ${formatLength(d.width,options)}`,`높이 ${formatLength(d.height,options)}`];
 if(options.includeDepth??(d.depth!==undefined))parts.push(`깊이 ${formatLength(d.depth,options)}`);
 return parts.join(' × ');
}

/** Raw coordinates in a provisional artwork are never physical metre values. */
export function formatArtworkRecordedDimensions(artwork:unknown):string {
 if(!artwork||typeof artwork!=='object'||Array.isArray(artwork))return NONE;
 const value=artwork as {schemaVersion?:unknown;dimensions?:unknown;extensions?:Record<string,unknown>};
 if(value.schemaVersion!=='1.0.0-draft.2')return formatArtworkDimensions(value.dimensions);
 const reference=value.extensions?.['org.exhibitos.studio/display-reference'];
 if(!reference||typeof reference!=='object'||Array.isArray(reference))return NONE;
 const q=reference as {status?:unknown;axisMapping?:unknown;catalogueDimensions?:unknown};
 if(q.status!=='provisional-uncalibrated'||q.axisMapping!=='unverified')return NONE;
 return formatArtworkDimensions(q.catalogueDimensions,{includeDepth:true});
}
