// SPDX-License-Identifier: AGPL-3.0-or-later
import type {ReactNode} from 'react';
import type {Exhibition} from '@exhibitos/spec';
import {entranceRuntime,entranceContent,catalogueStyle} from './entrance-runtime';
import {PosterCover} from './entrance-themes/PosterCover';
import {ArtworkCover} from './entrance-themes/ArtworkCover';
import {InvitationCover} from './entrance-themes/InvitationCover';
import {ThresholdCover} from './entrance-themes/ThresholdCover';
import type {ThemeProps} from './entrance-themes/types';
/** Inert metadata bootstrap uses the same reserved paper geometry as the verified cover. */
export function EntranceReadingShell({title,artist,introduction,hasImage,folded=true,ratio=4/3,status,exhibition,motion=true}:{title:string;artist?:string;introduction?:string;hasImage:boolean;folded?:boolean;ratio?:number;status:ReactNode;exhibition?:Exhibition;motion?:boolean}){
 const runtime=exhibition?entranceRuntime(exhibition,!motion):null;
 if(exhibition&&runtime){
  const content=entranceContent(exhibition);
  if(runtime.design.theme!=='catalogue'){
   const Component={poster:PosterCover,artwork:ArtworkCover,invitation:InvitationCover,threshold:ThresholdCover}[runtime.design.theme];
   const props:ThemeProps={content,image:{status:hasImage?'loading':'absent',width:ratio,height:1},design:{...runtime.design,effects:runtime.effects},coverState:motion?'pending':'flat',interactive:false,reducedMotion:!motion,layoutRef:null,entry:<div className="publication-entry-placeholder" aria-hidden="true"/>,children:status,onImageLoad:()=>{},onImageError:()=>{},onRetryImage:()=>{}};
   return <div className="publication-bootstrap" data-cover-bootstrap=""><Component {...props}/></div>;
  }
 }
 const copy=<><h1>{title}</h1>{artist&&<p className="entrance-cover-artist">{artist}</p>}{introduction&&<p className="entrance-cover-introduction">{introduction}</p>}</>;
 return <section style={runtime?catalogueStyle(runtime.design,runtime.authored,runtime.effects):undefined} className="entrance-cover publication-bootstrap" data-has-image={hasImage} data-paper-state={hasImage&&(runtime?runtime.effects.cover==='fold':folded)?'folded':'flat'}><div className="entrance-cover-spread"><div className="entrance-cover-copy entrance-paper-left"><div className="entrance-cover-prose">{copy}</div><div className="entrance-paper-ticket-slot" aria-hidden="true"/></div>{hasImage&&<div className="entrance-paper-leaf" style={{aspectRatio:String(ratio)}}><div className="entrance-paper-outside entrance-cover-copy" aria-hidden="true">{copy}</div><div className="entrance-paper-inside"/></div>}</div><div className="entrance-cover-actions">{status}</div></section>;
}
