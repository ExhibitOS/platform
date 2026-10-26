// SPDX-License-Identifier: AGPL-3.0-or-later
import {entranceFor,entryPresentationFor,resolveEntranceDesign,type EntranceThemeId,type ResolvedEntranceDesign} from '@exhibitos/studio-contract';
import type {CSSProperties} from 'react';
import type {Exhibition} from '@exhibitos/spec';
export function entranceRuntime(exhibition:Exhibition,reducedMotion=false,compact=false){
 const settings=entranceFor(exhibition),legacy=entryPresentationFor(exhibition),design=resolveEntranceDesign(settings.design),authored=settings.design!==undefined;
 const effects={...design.effects};
 if(!authored){effects.cover=legacy.coverUnfold?'fold':'none';effects.response=legacy.ticketAnimation?'tear':'none';effects.transition=legacy.doorEffect?'doors':'none';effects.strength=1;}
 if(reducedMotion||!effects.enabled||effects.strength===0){effects.cover='none';effects.response='none';effects.transition='none';}
 else if(compact){
  if(!authored)effects.cover='none';
  else if(effects.mobile==='none'){effects.cover='none';effects.response='none';effects.transition='none';}
  else {if(effects.cover!=='none')effects.cover='fade';if(effects.response==='tear')effects.response='press';if(effects.transition!=='none')effects.transition='fade';}
 }
 return {settings,design,authored,effects,variant:({catalogue:'tear',poster:'strip',artwork:'minimal',invitation:'confirm',threshold:'threshold'} satisfies Record<EntranceThemeId,string>)[design.theme] as 'tear'|'strip'|'minimal'|'confirm'|'threshold'};
}
export function entranceContent(exhibition:Exhibition,locale?:string,compact=false){
 const {settings,design}=entranceRuntime(exhibition),translations=design.translations;
 const selected=locale?translations.find(t=>t.locale.toLowerCase()===locale.toLowerCase())??translations.find(t=>t.locale.split('-')[0]!.toLowerCase()===locale.split('-')[0]!.toLowerCase()):undefined;
 return {title:compact?(selected?.shortTitle??selected?.title??exhibition.title):(selected?.title??exhibition.title),artist:selected?.artist??settings.artist,introduction:selected?.introduction??settings.introduction,imageAlt:settings.imageAlt,locale:selected?.locale};
}

export function catalogueStyle(design:ResolvedEntranceDesign,authored:boolean,effects:ResolvedEntranceDesign['effects']):CSSProperties|undefined{
  const palette=design.palette==='dark'?{paper:'#182d32',ink:'#f8fbfc',muted:'#c3d1d4'}:design.palette==='light'?{paper:'#ffffff',ink:'#182d32',muted:'#51656a'}:undefined;
  return authored?{'--cover-margin':`${design.layout.margin}px`,'--cover-title-scale':design.layout.titleScale,'--cover-fit':design.image.fit,'--cover-focus':`${design.image.focus[0]*100}% ${design.image.focus[1]*100}%`,'--cover-duration':`${620/effects.speed}ms`,'--cover-strength':effects.strength,...(palette?{'--publication-paper':palette.paper,'--publication-ink':palette.ink,'--publication-muted':palette.muted}:{}),...(design.type==='serif'?{'--cover-title-font':'"Iowan Old Style","Palatino Linotype","Noto Serif KR",serif'}:{})} as CSSProperties:undefined;
}
