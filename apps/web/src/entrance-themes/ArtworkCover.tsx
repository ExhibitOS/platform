// SPDX-License-Identifier: AGPL-3.0-or-later
import type {ThemeProps} from './types';
import './themes.css';
import {CoverCopy,CoverImage,themeAttributes} from './PosterCover';

export function ArtworkCover(props:ThemeProps){
  return <section className="entrance-theme entrance-theme-artwork" aria-label="전시 표지" {...themeAttributes(props)}>
    <div className="entrance-theme-layout" ref={props.layoutRef}>
      <CoverImage {...props}/>
      <div className="entrance-theme-caption">
        <CoverCopy content={props.content}/>
        <div className="entrance-theme-entry">{props.entry}</div>
      </div>
    </div>
    <div className="entrance-theme-utilities">{props.children}</div>
  </section>;
}
