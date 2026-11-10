// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useRef,useState} from 'react';
import {exitDestinationUrl,type ViewerExitDoor} from '@exhibitos/studio-contract';

export function confirmExitDestination(url:string,canNavigate:()=>boolean,navigate:(url:string)=>void):boolean {
  if(!canNavigate())return false;
  navigate(url);
  return true;
}

export function ExitConfirmation({door,onCancel,canNavigate,navigate}:{
  door: ViewerExitDoor;
  onCancel: () => void;
  canNavigate: () => boolean;
  navigate: (url:string) => void;
}) {
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null);
  const title=useId(),notice=useId(),choices=useId();
  const [selected,setSelected]=useState<string>();
  const [failed,setFailed]=useState(false);
  const destinations=[door.primary,...door.additional].flatMap(destination=>{
    const url=exitDestinationUrl(destination.url);
    return url?[{name:destination.name,url,host:new URL(url).host}]:[];
  });

  useEffect(()=>{
    const element=dialog.current;
    if(element&&!element.open)element.showModal();
    cancel.current?.focus({preventScroll:true});
    return ()=>{if(element?.open)element.close();};
  },[]);

  return <dialog ref={dialog} className="publication-exit-dialog" aria-labelledby={title} aria-describedby={notice}
    onCancel={event=>{event.preventDefault();onCancel();}}>
    <h2 id={title}>전시를 나갈까요?</h2>
    <p id={notice}>선택한 외부 웹사이트로 이동합니다.</p>
    <fieldset>
      <legend>이동할 웹사이트</legend>
      {destinations.map(destination=><label key={destination.url}>
        <input type="radio" name={choices} value={destination.url} checked={selected===destination.url}
          onChange={()=>{setSelected(destination.url);setFailed(false);}}/>
        <span>{destination.name}<small>{destination.host}</small></span>
      </label>)}
    </fieldset>
    {failed&&<p role="alert">웹사이트를 열지 못했어요.</p>}
    <div className="publication-exit-actions">
      <button ref={cancel} type="button" onClick={onCancel}>계속 관람</button>
      <button type="button" disabled={!selected} onClick={()=>{
        const destination=destinations.find(item=>item.url===selected);
        if(destination)try{if(!confirmExitDestination(destination.url,canNavigate,navigate))onCancel();}catch{setFailed(true);}
      }}>전시 나가기</button>
    </div>
  </dialog>;
}
