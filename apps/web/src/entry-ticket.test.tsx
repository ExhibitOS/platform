// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {EntryTicket} from './EntryTicket';

it('makes the ticket itself the accessible entry action without an issued credential',()=>{
 const html=renderToStaticMarkup(<EntryTicket title="Authored exhibition" detail="Public artist" active={false} animate={false} unavailable={false} buttonRef={null} onEnter={()=>{}}/>);
 expect(html.match(/<button\b/g)).toHaveLength(1);
 expect(html).toContain('aria-label="입장하기"');
 expect(html).toContain('Authored exhibition');expect(html).toContain('Public artist');
 const description=html.match(/aria-describedby="([^"]+)"/)?.[1];
 expect(description).toBeTruthy();expect(html).toContain(`id="${description}" class="publication-entry-ticket-body"`);
 expect(html).toContain('data-ticket-animation="false"');expect(html).not.toContain('disabled=""');
});
it('keeps busy and retry semantics and renders authored content as plain text',()=>{
 const html=renderToStaticMarkup(<EntryTicket title={'<img src="private" onerror="alert(1)">'} detail="Plain <b>text</b>" active animate unavailable buttonRef={null} onEnter={()=>{}}/>);
 expect(html).toContain('aria-label="3D 다시 시도 · 페이지 새로고침"');
 expect(html).toContain('disabled=""');expect(html).toContain('aria-busy="true"');
 expect(html).toContain('&lt;img');expect(html).not.toContain('<img');expect(html).not.toContain('<b>');
});
