// SPDX-License-Identifier: AGPL-3.0-or-later
import type {ReactNode} from 'react';
/** Inert metadata bootstrap uses the same reserved paper geometry as the verified cover. */
export function EntranceReadingShell({title,artist,introduction,hasImage,folded=true,ratio=4/3,status}:{title:string;artist?:string;introduction?:string;hasImage:boolean;folded?:boolean;ratio?:number;status:ReactNode}){
 const copy=<><h1>{title}</h1>{artist&&<p className="entrance-cover-artist">{artist}</p>}{introduction&&<p className="entrance-cover-introduction">{introduction}</p>}</>;
 return <section className="entrance-cover publication-bootstrap" data-has-image={hasImage} data-paper-state={hasImage&&folded?'folded':'flat'}><div className="entrance-cover-spread"><div className="entrance-cover-copy entrance-paper-left"><div className="entrance-cover-prose">{copy}</div><div className="entrance-paper-ticket-slot" aria-hidden="true"/></div>{hasImage&&<div className="entrance-paper-leaf" style={{aspectRatio:String(ratio)}}><div className="entrance-paper-outside entrance-cover-copy" aria-hidden="true">{copy}</div><div className="entrance-paper-inside"/></div>}</div><div className="entrance-cover-actions">{status}</div></section>;
}
