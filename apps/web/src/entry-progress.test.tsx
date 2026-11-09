// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {EntryProgress} from './EntryProgress';

it('stays quiet until the static download plan is known',()=>{
 expect(renderToStaticMarkup(<EntryProgress download={null}/>)).toBe('');
});

it('shows just the measured percentage without a visible bar or byte count',()=>{
 const html=renderToStaticMarkup(<EntryProgress download={{receivedBytes:65,requiredBytes:100}}/>);
 expect(html).toContain('role="progressbar"');
 expect(html).toContain('aria-valuenow="65"');
 expect(html).toContain('aria-valuemax="100"');
 expect(html).toContain('>65%</p>');
 expect(html).not.toMatch(/바이트|MB|전시장 준비 중|<span/);
});

it('never shows 100 percent before the exact bytes complete',()=>{
 const html=renderToStaticMarkup(<EntryProgress download={{receivedBytes:Number.MAX_SAFE_INTEGER-1,requiredBytes:Number.MAX_SAFE_INTEGER}}/>);
 expect(html).toContain('>99%</p>');
});

it('shows the same preparation text for completed downloads and the existing dynamic fallback',()=>{
 for(const download of [undefined,{receivedBytes:65536,requiredBytes:65536}]){
  const html=renderToStaticMarkup(<EntryProgress download={download}/>);
  expect(html).toContain('role="status"');
  expect(html).toContain('>전시장 준비 중</p>');
  expect(html).not.toMatch(/aria-value|progressbar|<span/);
 }
});
