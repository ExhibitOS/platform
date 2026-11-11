// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {DetailQualityControl} from './DetailQualityControl';

it('keeps the currently drawn glyph while the next tier downloads real bytes',()=>{
 const html=renderToStaticMarkup(<DetailQualityControl tier="lightweight" flat progress={{tier:'approved-full',loadedBytes:65,totalBytes:100}}/>);
 expect(html).toContain('aria-label="현재 표시 품질: 경량 이미지"');
 expect(html).toContain('stroke-dashoffset="0.35"');
 expect(html).toContain('max="100"');
 expect(html).toContain('value="65"');
 expect(html.indexOf('</details>')).toBeLessThan(html.indexOf('<progress'));
});

it('uses honest preparation semantics for unknown total instead of a fraction',()=>{
 const html=renderToStaticMarkup(<DetailQualityControl tier="lightweight" flat={false} progress={{tier:'approved-full',loadedBytes:0,totalBytes:null}}/>);
 expect(html).toContain('현재 표시 품질: 경량 모델');
 expect(html).toContain('승인된 고화질 준비 중');
 expect(html).toContain('detail-quality-ring-pending');
 expect(html).not.toMatch(/stroke-dashoffset|max=|value=/);
});

it('ends the transfer arc at byte completion without promoting the displayed tier',()=>{
 const html=renderToStaticMarkup(<DetailQualityControl tier="approved-full" flat progress={{tier:'acquired-original',loadedBytes:100,totalBytes:100}}/>);
 expect(html).toContain('현재 표시 품질: 승인된 고화질');
 expect(html).toContain('원본 파일 표시 준비 중');
 expect(html).not.toMatch(/<progress|detail-quality-ring-value|detail-quality-ring-pending/);
});

it('does not replay lower-tier progress when a higher tier is already drawn',()=>{
 const html=renderToStaticMarkup(<DetailQualityControl tier="acquired-original" flat={false} progress={{tier:'approved-full',loadedBytes:20,totalBytes:100}}/>);
 expect(html).toContain('현재 표시 품질: 원본 파일');
 expect(html).not.toMatch(/<progress|detail-quality-ring|role="status"/);
});

it('clears ended progress while preserving the actual current tier',()=>{
 const html=renderToStaticMarkup(<DetailQualityControl tier="approved-full" flat progress={null}/>);
 expect(html).toContain('현재 표시 품질: 승인된 고화질');
 expect(html).not.toMatch(/<progress|detail-quality-ring|role="status"/);
});
