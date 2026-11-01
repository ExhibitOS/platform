// SPDX-License-Identifier: AGPL-3.0-or-later
import {useId,useRef,type ReactNode} from 'react';

export const privateTools=[['artwork','작품'],['space','공간'],['lighting','조명'],['surface','표면'],['bench','벤치'],['copies','사본']] as const;
export type PrivateTool=typeof privateTools[number][0];

/** Visibility changes only: keep settings mounted so draft inputs survive a
 * tool switch, collapse, close and responsive layout changes. */
export function ToolPanel({active,open,collapsed,disabled,onSelect,onClose,onCollapse,children}:{active:PrivateTool;open:boolean;collapsed:boolean;disabled:boolean;onSelect:(tool:PrivateTool)=>void;onClose:()=>void;onCollapse:()=>void;children:ReactNode}){
 const id=useId(),buttons=useRef<Partial<Record<PrivateTool,HTMLButtonElement|null>>>({});
 const label=privateTools.find(([key])=>key===active)![1];
 function close(){onClose();buttons.current[active]?.focus();}
 return <aside className="private-tool-panel" data-open={open} data-collapsed={collapsed} aria-label="꾸미기 도구와 설정">
  <nav className="private-tool-chooser" aria-label="꾸미기 도구">{privateTools.map(([key,name])=><button key={key} ref={button=>{buttons.current[key]=button;}} disabled={disabled} aria-pressed={open&&active===key} aria-controls={id} onClick={()=>onSelect(key)}>{name}</button>)}</nav>
  <section className="private-tool-settings" hidden={!open} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented)close();}} aria-labelledby={id+'-heading'}>
   <header className="private-tool-heading"><h2 id={id+'-heading'}>{label}</h2><div><button aria-expanded={!collapsed} aria-controls={id} onClick={onCollapse}>{collapsed?'설정 펼치기':'설정 접기'}</button><button onClick={close}>설정 닫기</button></div></header>
   <div id={id} className="private-tool-scroll" role="region" aria-label={label+' 설정 내용'} tabIndex={0} hidden={collapsed}>{children}</div>
  </section>
 </aside>;
}
