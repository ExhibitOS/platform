// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useState} from 'react';
import type {Exhibition} from '@exhibitos/spec';
import {lightDetailsFor,lightKelvinLinear,setLightDetails} from '@exhibitos/studio-contract';
import type {GeometryCommand} from '../geometry/model';

/** Reuse the producer's explicit Kelvin intent; never infer it from loaded RGB. */
export function lightTemperatureCommand(document:Exhibition,lightId:string,raw:string):GeometryCommand {
 const kelvin=raw.trim()?Number(raw):NaN;
 if(!Number.isFinite(kelvin)||kelvin<1000||kelvin>20000)throw Error('LIGHT_TEMPERATURE_INVALID');
 const light=document.lights.find(value=>value.id===lightId);if(!light)throw Error('LIGHT_DETAILS_REFERENCE');
 const {id,...value}=light,details=lightDetailsFor(document).find(item=>item.lightId===id);
 const {lightId:ignored,...settings}=details??{lightId:id,fixture:'none' as const};void ignored;
 return {type:'replace-architecture',candidate:setLightDetails(document,id,{...value,color:lightKelvinLinear(kelvin)},{...settings,temperatureKelvin:kelvin})};
}

export function LightTemperatureControls({document,lightId,disabled,execute,error}:{document:Exhibition;lightId:string;disabled:boolean;execute:(command:GeometryCommand)=>void;error:(message:string)=>void}){
 const current=lightDetailsFor(document).find(value=>value.lightId===lightId)?.temperatureKelvin;
 const [raw,setRaw]=useState(current===undefined?'':String(current)),descriptionId=useId();
 const numeric=raw.trim()?Number(raw):NaN,inRange=Number.isFinite(numeric)&&numeric>=1000&&numeric<=20000,rangeValue=inRange?numeric:1000;
 useEffect(()=>{setRaw(current===undefined?'':String(current));},[lightId,current]);
 function apply(){
  if(disabled)return;
  try{execute(lightTemperatureCommand(document,lightId,raw));}
  catch{error('색온도는 1000~20000 K의 숫자로 입력해 주세요. 기존 조명은 유지됩니다.');}
 }
 return <form onSubmit={event=>{event.preventDefault();apply();}}>
  <fieldset disabled={disabled}>
   <legend>색온도</legend>
   <p id={descriptionId}>{current===undefined?'직접 지정한 색상을 사용하고 있어요.':'적용한 색온도: '+current+' K'} 화면에서 보이는 색의 근사값이에요.</p>
   <label className="private-range-label">색온도 조절<input type="range" aria-label="따뜻하게 또는 차갑게" min="1000" max="20000" step="any" value={rangeValue} aria-valuetext={inRange?raw+' K':raw.trim()?'입력한 색온도를 확인하세요.':'색온도 미지정. 움직여 새 색온도를 선택하세요.'} aria-describedby={descriptionId} onChange={event=>setRaw(event.target.value)}/></label>
   <div className="private-range-ends"><span>따뜻하게</span><output>{inRange?raw+' K':raw.trim()?'수치 확인 필요':'미지정'}</output><span>차갑게</span></div>
   <details><summary>색온도 수치</summary><label>색온도 (K)<input type="number" min="1000" max="20000" step="any" value={raw} aria-describedby={descriptionId} onChange={event=>setRaw(event.target.value)}/></label></details>
   <button type="submit">색온도 적용</button>
   <p>색상을 직접 골라 적용하면 색온도 설정은 해제돼요.</p>
  </fieldset>
 </form>;
}
