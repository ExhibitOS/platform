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
   <label>색온도 (K)<input type="number" min="1000" max="20000" step="any" value={raw} aria-describedby={descriptionId} onChange={event=>setRaw(event.target.value)}/></label>
   <button type="submit">색온도 적용</button>
   <p>색상을 직접 고르면 색온도 설정은 해제돼요.</p>
  </fieldset>
 </form>;
}
