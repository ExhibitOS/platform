// SPDX-License-Identifier: AGPL-3.0-or-later
const ordinaryIntensity=new Intl.NumberFormat('en-US',{useGrouping:false,maximumSignificantDigits:4});

/** Presentation only. Never use this text to replace a stored intensity. */
export function formatLightIntensity(value:number):string{
 if(!Number.isFinite(value)||value<0)return String(value);
 if(value===0)return '0';
 let text:string;
 if(value<1e-6||value>=1e9){
  const [mantissa,exponent]=value.toExponential(3).split('e');
  text=`${mantissa!.replace(/\.?0+$/,'')}e${exponent}`;
 }else text=ordinaryIntensity.format(value);
 // A rounded extreme must not become Infinity or erase a positive subnormal.
 return Number.isFinite(Number(text))&&Number(text)>0?text:String(value);
}

/** Focus exposes the exact editable text; blur changes presentation only. */
export function lightIntensityInputText(raw:string,editing=false):string{
 if(editing||!raw.trim())return raw;
 const value=Number(raw);
 return Number.isFinite(value)&&value>=0?formatLightIntensity(value):raw;
}

export function lightIntensityUnit(unit:string|undefined){
 const known:Record<string,{symbol:string;name:string}>={candela:{symbol:'cd',name:'칸델라'},lumen:{symbol:'lm',name:'루멘'},lux:{symbol:'lx',name:'럭스'}};
 if(unit&&Object.hasOwn(known,unit)){const value=known[unit]!;return {...value,label:` (${value.symbol})`,description:`단위: ${value.name} (${value.symbol})`};}
 return {symbol:unit??'',name:unit?`단위 ${unit} (지원하지 않는 단위)`:'단위 정보 없음',label:unit?` (단위: ${unit})`:'',description:unit?`지원하지 않는 단위: ${unit}`:'단위 정보 없음'};
}

export function lightIntensityValueText(raw:string,unit:string|undefined,editing=false):string{
 const value=raw.trim()?Number(raw):NaN;
 if(!Number.isFinite(value)||value<0)return '입력한 밝기를 확인하세요.';
 const text=lightIntensityInputText(raw,editing),scientific=text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))[eE]([+-]?\d+)$/);
 const spoken=scientific?`${scientific[1]} 곱하기 10의 ${Number(scientific[2])<0?'마이너스 ':''}${Math.abs(Number(scientific[2]))}제곱`:text;
 return `${spoken} ${lightIntensityUnit(unit).name}`;
}
