// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {EntryProgress} from './EntryProgress';
it('reports unknown total without a numeric percentage or estimated time, across real phases',()=>{
 for(const phase of ['space','artwork','navigation'] as const){
  const html=renderToStaticMarkup(<EntryProgress active phase={phase}/>);
  expect(html).toContain('role="progressbar"');expect(html).toContain('aria-label="전시장 입장 준비"');
  expect(html).toContain('aria-valuetext=');expect(html).toContain('role="status"');
  expect(html).not.toContain('aria-valuenow');expect(html).not.toMatch(/\d+%|남은 시간/);
 }
});
it('ends progress on failure, retaining its reserved space for recovery controls',()=>{
 const html=renderToStaticMarkup(<EntryProgress active={false} phase="space"/>);
 expect(html).toContain('publication-entry-meter-space');expect(html).not.toContain('progressbar');expect(html).not.toContain('role="status"');
});

it('shows only the measured percentage on the cover and during entry',()=>{
 for(const cover of [false,true]){
  const html=renderToStaticMarkup(<EntryProgress active phase="artwork" cover={cover} download={{receivedBytes:65,requiredBytes:100}}/>);
  expect(html).toContain('aria-valuenow="65"');
  expect(html).toContain('aria-valuemax="100"');
  expect(html).toContain('aria-valuetext="65%"');
  expect(html).toContain('>65%</p>');
  expect(html).not.toMatch(/바이트|MB/);
  expect(html).not.toContain('첫 작품을 준비');
 }
});
it('keeps preparation indeterminate once bytes finish and leaves the cover usable',()=>{
 const almostComplete=renderToStaticMarkup(<EntryProgress active phase="navigation"
  download={{receivedBytes:Number.MAX_SAFE_INTEGER-1,requiredBytes:Number.MAX_SAFE_INTEGER}}/>);
 expect(almostComplete).toContain('aria-valuenow="99"');
 const download={receivedBytes:65536,requiredBytes:65536};
 const entry=renderToStaticMarkup(<EntryProgress active phase="navigation" download={download}/>);
 expect(entry).toContain('안전한 관람을 준비하고 있어요.');
 expect(entry).toContain('role="progressbar"');
 expect(entry).not.toContain('aria-valuenow');
 const cover=renderToStaticMarkup(<EntryProgress active phase="space" cover download={download}/>);
 expect(cover).toContain('입장에 필요한 파일을 받았어요.');
 expect(cover).not.toContain('role="progressbar"');
});
