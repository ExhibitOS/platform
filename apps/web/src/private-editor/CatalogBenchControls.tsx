// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useState} from 'react';
import type {Exhibition} from '@exhibitos/spec';
import {furnishingsFor} from '@exhibitos/studio-contract';
import type {GeometryCommand} from '../geometry/model';
import type {PrivateSeed} from './model';
import {loadCatalogBench} from './catalog-bench';
import {privateCatalogBench} from './catalog-bench-renderer';
import {addCatalogBench,removeCatalogBench} from './catalog-bench-edit';

export function CatalogBenchControls({document,seed,roomId,disabled,execute,error}:{document:Exhibition;seed:PrivateSeed;roomId:string;disabled:boolean;execute:(command:GeometryCommand)=>void;error:(message:string)=>void}){
 const [available,setAvailable]=useState(false);
 useEffect(()=>{const abort=new AbortController();setAvailable(false);void loadCatalogBench(seed,abort.signal).then(ok=>{if(!abort.signal.aborted)setAvailable(ok);});return()=>abort.abort();},[seed]);
 const exists=!!furnishingsFor(document)?.bindings.some(b=>b.hostKind==='bench'),room=document.rooms.find(r=>r.id===roomId),selected=privateCatalogBench(document),inRoom=selected?.resolved.roomId.toLowerCase()===roomId.toLowerCase();
 function add(){if(!available||exists||!room)return;try{execute({type:'replace-architecture',candidate:addCatalogBench(document,room.id)});
 }catch(problem){error(problem instanceof Error&&problem.message==='BENCH_VIEWPOINT_LIMIT'?'관람 시점이 가득 차 벤치를 놓을 수 없어요. 새 사본이나 다른 저장 사본을 이용해 주세요.':'이 공간에는 벤치를 배치할 수 없어요. 공간의 크기와 위치를 확인해 주세요.');}}
 function remove(){if(!selected||!inRoom)return;try{execute({type:'replace-architecture',candidate:removeCatalogBench(document,selected.binding.hostId)});}catch{error('벤치를 삭제하지 못했어요. 기존 편집은 유지됩니다.');}}
 return <section aria-label="전시 벤치"><h3>전시 벤치</h3><p>방 중앙에 벤치를 놓고 보행 관람에서 앉은 시점을 선택할 수 있어요.</p>{!available&&!exists&&<p>현재 사용할 벤치 파일을 확인할 수 없어요.</p>}{exists&&<p>{inRoom?'이 전시실에 참나무 벤치가 있어요.':'다른 전시실에 카탈로그 벤치가 있어요.'}</p>}<button disabled={disabled||!available||exists} onClick={add}>참나무 벤치 놓기</button>{inRoom&&<button disabled={disabled} onClick={remove}>참나무 벤치 삭제</button>}</section>;
}
