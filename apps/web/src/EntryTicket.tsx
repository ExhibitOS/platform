// SPDX-License-Identifier: AGPL-3.0-or-later
import {useId,type Ref} from 'react';

/** The ticket is the action itself; it never represents a reservation or issued credential. */
export function EntryTicket({title,detail,active,animate,unavailable,buttonRef,onEnter}:{
  title:string;detail:string;active:boolean;animate:boolean;unavailable:boolean;
  buttonRef:Ref<HTMLButtonElement>;onEnter:()=>void;
}){
  const action=unavailable?'3D 다시 시도 · 페이지 새로고침':'입장하기';
  const descriptionId=useId();
  return <button type="button" className="publication-enter publication-entry-ticket" ref={buttonRef}
    onClick={onEnter} disabled={active} aria-busy={active} aria-label={action} aria-describedby={descriptionId}
    data-entering={active} data-ticket-animation={animate}>
    <span id={descriptionId} className="publication-entry-ticket-body">
      <span className="publication-entry-ticket-label">관람권</span>
      <strong>{title}</strong>
      {detail&&<span className="publication-entry-ticket-detail">{detail}</span>}
    </span>
    <span className="publication-entry-ticket-stub" aria-hidden="true">{action}<span>↗</span></span>
  </button>;
}
