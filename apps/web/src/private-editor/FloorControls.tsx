// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useState} from 'react';
import type {Exhibition} from '@exhibitos/spec';
import {applyFloorPreset,createFloorPreset,floorFor,floorTexturePack,FLOOR_NAMESPACE,type FloorPreset,type StudioFloors} from '@exhibitos/studio-contract';
import type {GeometryCommand} from '../geometry/model';
import type {PrivateSeed} from './model';
import {loadAvailableFloorPacks} from './floor-pack-availability';

const labels:Record<FloorPreset,string>={wood:'나무',marble:'대리석',tile:'타일',carpet:'카펫'};
export function FloorControls({document,seed,roomId,surfaceId,disabled,execute,error}:{document:Exhibition;seed:PrivateSeed;roomId:string;surfaceId:string;disabled:boolean;execute:(command:GeometryCommand)=>void;error:(message:string)=>void}){
 const [available,setAvailable]=useState<FloorPreset[]>([]),[choice,setChoice]=useState('');
 useEffect(()=>{const abort=new AbortController();setAvailable([]);void loadAvailableFloorPacks(seed,abort.signal).then(p=>{if(!abort.signal.aborted)setAvailable(p);});return()=>abort.abort();},[seed]);
 useEffect(()=>{const binding=floorFor(document,{roomId,surfaceId}),pack=binding&&floorTexturePack(binding);const current=pack&&(['wood','marble','tile','carpet'] as const).find(p=>createFloorPreset({kind:'surface',surfaceId},p).texturePack?.id===pack.id);setChoice(current??'');},[document,roomId,surfaceId]);
 function apply(){
  if(!available.includes(choice as FloorPreset)){error('사용할 바닥 재질을 선택해 주세요.');return;}
  try{
   const preset=choice as FloorPreset,current=floorFor(document,{roomId,surfaceId}),candidate=structuredClone(document);
   const floors=(candidate.extensions?.[FLOOR_NAMESPACE] as unknown as StudioFloors|undefined)??{version:1 as const,bindings:[]};
   const next=current?applyFloorPreset(current,preset,['color','roughness','metalness','repeatMeters','rotation','texturePack','normalScale','aoStrength']):createFloorPreset({kind:'surface',surfaceId},preset);
   // A newly authored appearance must not enable a different footstep family.
   if(!current)delete next.sound;
   const i=floors.bindings.findIndex(b=>b.target.kind==='surface'&&b.target.surfaceId.toLowerCase()===surfaceId.toLowerCase());
   if(i<0)floors.bindings.push(next);else floors.bindings[i]=next;
   candidate.extensions={...candidate.extensions,[FLOOR_NAMESPACE]:floors as unknown as NonNullable<Exhibition['extensions']>[string]};execute({type:'replace-architecture',candidate});
  }catch{error('바닥 재질을 적용할 수 없어요. 기존 설정은 유지됩니다.');}
 }
 return <div className="private-floor-finish"><label>바닥 무늬<select aria-label="바닥 무늬" disabled={disabled} value={choice} onChange={e=>setChoice(e.target.value)}><option value="">선택하세요</option>{choice&&!available.includes(choice as FloorPreset)&&<option value={choice} disabled>기존 무늬 (현재 선택 불가)</option>}{available.map(p=><option value={p} key={p}>{labels[p]}</option>)}</select></label><p>바닥 무늬만 바꾸며 기존 발소리 설정은 유지합니다.</p><button disabled={disabled||!available.includes(choice as FloorPreset)} onClick={apply}>바닥 무늬 적용</button></div>;
}
