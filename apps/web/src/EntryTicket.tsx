// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useState,type Ref} from 'react';

/** A device-local minute, not an issued time, expiry, or server credential. */
export function localTicketMinute(now:Date){
 const pad=(n:number)=>String(n).padStart(2,'0');
 const date=`${now.getFullYear()}.${pad(now.getMonth()+1)}.${pad(now.getDate())}`;
 const minute=`${pad(now.getHours())}:${pad(now.getMinutes())}`;
 return {date,minute,dateTime:`${date.replaceAll('.','-')}T${minute}`};
}
/** The ticket is the action itself; it never represents a reservation or issued credential. */
export function EntryTicket({title,active,animate,unavailable,buttonRef,onEnter,variant='tear',showDate=true,showTime=true}:{
  title:string;active:boolean;animate:boolean;unavailable:boolean;
  buttonRef:Ref<HTMLButtonElement>;onEnter:()=>void;variant?:'tear'|'strip'|'minimal'|'confirm'|'threshold';showDate?:boolean;showTime?:boolean;
}){
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{
    if(active)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{
      clearTimeout(timer);
      if(document.hidden)return;
      setNow(new Date());
      timer=setTimeout(refresh,60000-Date.now()%60000);
    };
    refresh();document.addEventListener('visibilitychange',refresh);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);};
  },[active]);
  const action=unavailable?'3D 다시 시도 · 페이지 새로고침':'입장하기';
  const descriptionId=useId(),local=localTicketMinute(now);
  const time=(showDate||showTime)&&<time className="publication-entry-ticket-time" dateTime={local.dateTime}>{showDate&&<span>{local.date}</span>}{showTime&&<span>{local.minute}</span>}</time>;
  if(variant!=='tear')return <button type="button" className={`publication-enter publication-entry-action publication-entry-action--${variant}`} ref={buttonRef} onClick={onEnter} disabled={active} aria-busy={active} aria-label={action} data-entering={active}>
    <span>{action}</span>{time&&<span className="publication-entry-action-time">{time}</span>}
  </button>;
  return <button type="button" className="publication-enter publication-entry-ticket" ref={buttonRef}
    onClick={onEnter} disabled={active} aria-busy={active} aria-label={action} aria-describedby={descriptionId}
    data-entering={active} data-ticket-animation={animate}>
    <span id={descriptionId} className="publication-entry-ticket-body">
      <strong>{title}</strong>
      {time}
    </span>
    <span className="publication-entry-ticket-stub" aria-hidden="true">입장하기</span>
  </button>;
}
