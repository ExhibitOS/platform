// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useRef,useState} from 'react';
import {exitDestinationUrl,type ViewerExitDoor} from '@exhibitos/studio-contract';

export function confirmExitDestination(url:string,canNavigate:()=>boolean,navigate:(url:string)=>void):boolean {
  if(!canNavigate())return false;
  navigate(url);
  return true;
}

export function ExitConfirmation({door,onCancel,onReturnToCover,canNavigate,navigate}:{
  door: ViewerExitDoor;
  onCancel: () => void;
  onReturnToCover: () => void;
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

  const selectedDestination=destinations.find(destination=>destination.url===selected);

  useEffect(()=>{
    const element=dialog.current;
    if(element&&!element.open)element.showModal();
    cancel.current?.focus({preventScroll:true});
    return ()=>{if(element?.open)element.close();};
  },[]);

  return <dialog ref={dialog} className="publication-exit-dialog" aria-labelledby={title} aria-describedby={notice}
    onCancel={event=>{event.preventDefault();onCancel();}}>
    <h2 id={title}>전시를 나갈까요?</h2>
    <p id={notice}>웹사이트를 선택하면 해당 사이트로 이동합니다. 선택하지 않으면 이 전시의 입장 화면으로 돌아갑니다.</p>
    <fieldset>
      <legend>이동할 웹사이트 (선택 사항)</legend>
      {destinations.map(destination=><label key={destination.url}>
        <input type="radio" name={choices} value={destination.url} checked={selected===destination.url}
          onChange={()=>{setSelected(destination.url);setFailed(false);}}/>
        <span className="publication-exit-destination"><span>{destination.name}</span><small>{destination.host}</small></span>
      </label>)}
    </fieldset>
    {failed&&<p role="alert">웹사이트를 열지 못했어요.</p>}
    <div className="publication-exit-actions">
      <button ref={cancel} type="button" onClick={onCancel}>계속 관람</button>
      <button type="button" aria-label={selectedDestination&&`${selectedDestination.name} (${selectedDestination.host}) 웹사이트로 이동`} onClick={()=>{
        if(!selectedDestination){
          if(canNavigate())onReturnToCover();
          else onCancel();
          return;
        }
        try{
          if(!confirmExitDestination(selectedDestination.url,canNavigate,navigate))onCancel();
        }catch{setFailed(true);}
      }}>{selectedDestination
        ?<><span className="publication-exit-action-name">{selectedDestination.name}</span><span>으로 이동</span></>
        :'입장 화면으로 돌아가기'}</button>
    </div>
  </dialog>;
}
