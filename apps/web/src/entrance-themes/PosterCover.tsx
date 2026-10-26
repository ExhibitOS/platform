// SPDX-License-Identifier: AGPL-3.0-or-later
import type {CSSProperties} from 'react';
import type {ThemeProps} from './types';
import './themes.css';

/** Layout-only adapters: verified bytes, generation checks and lifecycle belong to the host. */
export function themeAttributes(props:ThemeProps){
  const {design,image,reducedMotion,coverState}=props;
  return {
    'data-has-image':image.status!=='absent',
    'data-cover-state':coverState,
    'data-cover-effect':design.effects.enabled&&!reducedMotion?design.effects.cover:'none',
    'data-response':design.effects.enabled&&!reducedMotion?design.effects.response:'none',
    'data-palette':design.palette,
    'data-type':design.type,
    'data-reduced-motion':reducedMotion,
    'data-mobile-motion':design.effects.mobile,
    style:{
      '--theme-margin':`${design.layout.margin}px`,
      '--theme-title-scale':design.layout.titleScale,
      '--theme-copy-ratio':design.layout.copyRatio,
      '--theme-image-fit':design.image.fit,
      '--theme-image-focus':`${design.image.focus[0]*100}% ${design.image.focus[1]*100}%`,
      '--theme-source-ratio':image.width&&image.height?String(image.width/image.height):'4/3',
      '--theme-duration':`${400/design.effects.speed}ms`,
      '--theme-strength':design.effects.strength,
    } as CSSProperties,
  };
}
export function CoverCopy({content}:Pick<ThemeProps,'content'>){
  return <div className="entrance-theme-copy">
    <h1 className="entrance-theme-title">{content.title}</h1>
    {content.artist&&<p className="entrance-theme-artist">{content.artist}</p>}
    {content.introduction&&<p className="entrance-theme-introduction">{content.introduction}</p>}
  </div>;
}
export function CoverImage({image,content,interactive,onImageLoad,onImageError,onRetryImage}:ThemeProps){
  if(image.status==='absent')return null;
  const failed=image.status==='failed',busy=image.status==='loading'||image.status==='decoded';
  return <figure className="entrance-theme-image" data-image-state={image.status} aria-busy={busy}>
    {image.url&&!failed&&<img key={image.url} src={image.url} width={image.width} height={image.height} alt={content.imageAlt} decoding="async" onLoad={onImageLoad} onError={onImageError}/>}
    {failed&&<div className="entrance-theme-image-message"><p>표지를 불러오지 못했어요. 입장과 텍스트 관람은 이용할 수 있어요.</p>{interactive&&<button type="button" onClick={onRetryImage}>표지 다시 불러오기</button>}</div>}
    {!image.url&&!failed&&<div className="entrance-theme-image-message">표지 이미지를 준비하고 있어요.</div>}
  </figure>;
}
export function PosterCover(props:ThemeProps){
  return <section className="entrance-theme entrance-theme-poster" aria-label="전시 표지" {...themeAttributes(props)}>
    <div className="entrance-theme-layout" ref={props.layoutRef}>
      <CoverCopy content={props.content}/>
      <CoverImage {...props}/>
      <div className="entrance-theme-entry">{props.entry}</div>
    </div>
    <div className="entrance-theme-utilities">{props.children}</div>
  </section>;
}
