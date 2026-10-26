// SPDX-License-Identifier: AGPL-3.0-or-later
import {createElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {resolveEntranceDesign} from '@exhibitos/studio-contract';
import type {ThemeProps} from './types';
import {PosterCover,CoverImage,themeAttributes} from './PosterCover';
import {ArtworkCover} from './ArtworkCover';
import {InvitationCover} from './InvitationCover';
import {ThresholdCover} from './ThresholdCover';

const themes=[['poster',PosterCover],['artwork',ArtworkCover],['invitation',InvitationCover],['threshold',ThresholdCover]] as const;
function props(theme:ThemeProps['design']['theme']):ThemeProps{
  return {
    content:{title:'긴 전시 제목: 빛과 공간 <2026>',artist:'작가 이름',introduction:'짧은 소개\nSecond language',imageAlt:'전시 대표 이미지 설명'},
    image:{status:'ready',url:'blob:verified-cover',width:1200,height:800},
    design:resolveEntranceDesign({version:1,theme}),coverState:'open',interactive:true,reducedMotion:false,layoutRef:null,
    entry:createElement('button',{type:'button','data-real-entry':true},'입장하기'),
    children:createElement('a',{href:'#text','data-text-view':true},'텍스트로 전시 관람'),
    onImageLoad:vi.fn(),onImageError:vi.fn(),onRetryImage:vi.fn(),
  };
}
describe.each(themes)('%s presentation', (theme,Component)=>{
  it('renders exactly one host action and heading, meaningful image description and independent text access',()=>{
    const p=props(theme),html=renderToStaticMarkup(createElement(Component,p));
    expect(html.match(/data-real-entry=/g)).toHaveLength(1);
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toContain('빛과 공간 &lt;2026&gt;');
    expect(html).toContain('alt="전시 대표 이미지 설명"');
    expect(html).toContain('data-text-view="true"');
    expect(html).not.toContain('aria-hidden="true"');
  });
  it('keeps real entry, full title and text access during absent/slow/failed image states',()=>{
    for(const status of ['absent','loading','failed'] as const){
      const p=props(theme);p.image={status};p.content.title='긴 제목 '.repeat(100);
      const html=renderToStaticMarkup(createElement(Component,p));
      expect(html).toContain(p.content.title);
      expect(html.match(/data-real-entry=/g)).toHaveLength(1);
      expect(html).toContain('data-text-view="true"');
      expect(html).not.toContain('<img');
      expect(html.includes('표지 다시 불러오기')).toBe(status==='failed');
    }
  });
  it('does not require image or animation completion to expose controls; reduced motion wins',()=>{
    const p=props(theme);p.coverState='pending';p.image={status:'loading'};p.reducedMotion=true;
    const html=renderToStaticMarkup(createElement(Component,p));
    expect(html).toContain('data-cover-effect="none"');
    expect(html).toContain('data-response="none"');
    expect(html).toContain('data-real-entry="true"');
    expect(html).not.toContain('disabled');
  });
});
it('forwards decoded image and retry events to the shared generation owner',()=>{
  const p=props('poster');p.image.status='decoded';
  const figure=CoverImage(p) as ReactElement<{children:ReactElement<{onLoad:()=>void;onError:()=>void}>[]}>;
  const image=figure.props.children[0]!;
  image.props.onLoad();image.props.onError();
  expect(p.onImageLoad).toHaveBeenCalledTimes(1);expect(p.onImageError).toHaveBeenCalledTimes(1);
  p.image.status='failed';
  const failed=CoverImage(p) as ReactElement<{children:(ReactElement<{children:ReactElement<{onClick:()=>void}>[]}>|false)[]}>;
  const message=failed.props.children[1];
  if(!message)throw Error('Missing recovery');
  message.props.children[1]!.props.onClick();expect(p.onRetryImage).toHaveBeenCalledTimes(1);
  p.interactive=false;
  expect(renderToStaticMarkup(createElement(CoverImage,p))).not.toContain('button');
});
it('uses explicit fit and normalized focal point without altering verified image or mutating authored design',()=>{
  const p=props('poster');p.design.image={fit:'cover',focus:[.2,.8]};
  const before=structuredClone(p.design),attrs=themeAttributes(p);
  expect(attrs.style).toMatchObject({'--theme-image-fit':'cover','--theme-image-focus':'20% 80%'});
  expect(p.design).toEqual(before);expect(p.image.url).toBe('blob:verified-cover');
  const art=props('artwork');expect(themeAttributes(art).style).toMatchObject({'--theme-image-fit':'contain'});
});
