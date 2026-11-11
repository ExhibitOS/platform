// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {EntryProgress} from './EntryProgress';

it('gives honest preparation feedback after Enter while the static plan is unknown',()=>{
 const html=renderToStaticMarkup(<EntryProgress download={null}/>);
 expect(html).toContain('role="status"');
 expect(html).toContain('전시장 준비 중');
 expect(html).not.toContain('<progress');
});

it('shows a named native gauge using received required bytes, without visible numbers',()=>{
 const html=renderToStaticMarkup(<EntryProgress download={{receivedBytes:65,requiredBytes:100}}/>);
 expect(html).toContain('<progress');
 expect(html).toContain('aria-label="전시장 입장 파일 받는 중"');
 expect(html).toContain('max="100"');
 expect(html).toContain('value="65"');
 expect(html).toContain('전시장에 필요한 파일을 받고 있어요.');
 expect(html).not.toMatch(/65%|바이트|MB/);
});

it('keeps the exact byte ratio near completion rather than rounding to a finished transfer',()=>{
 const html=renderToStaticMarkup(<EntryProgress download={{receivedBytes:Number.MAX_SAFE_INTEGER-1,requiredBytes:Number.MAX_SAFE_INTEGER}}/>);
 expect(html).toContain('max="9007199254740991"');
 expect(html).toContain('value="9007199254740990"');
});

it('does not leave a completed transfer gauge while scene or navigation preparation remains',()=>{
 for(const download of [undefined,{receivedBytes:65536,requiredBytes:65536},{receivedBytes:0,requiredBytes:null}]){
  const html=renderToStaticMarkup(<EntryProgress download={download}/>);
  expect(html).toContain('role="status"');
  expect(html).toContain('>전시장 준비 중</p>');
  expect(html).not.toMatch(/aria-value|<progress/);
 }
});

it('never manufactures a ratio from invalid counts',()=>{
 for(const download of [{receivedBytes:-1,requiredBytes:100},{receivedBytes:3,requiredBytes:0},{receivedBytes:NaN,requiredBytes:100}]){
  const html=renderToStaticMarkup(<EntryProgress download={download}/>);
  expect(html).toContain('전시장 준비 중');
  expect(html).not.toContain('<progress');
 }
});
