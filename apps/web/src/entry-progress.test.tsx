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
