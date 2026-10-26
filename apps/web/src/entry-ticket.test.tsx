// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi,afterEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {EntryTicket,localTicketMinute} from './EntryTicket';

it('makes the ticket itself the accessible entry action without an issued credential',()=>{
 const html=renderToStaticMarkup(<EntryTicket title="Authored exhibition" active={false} animate={false} unavailable={false} buttonRef={null} onEnter={()=>{}}/>);
 expect(html.match(/<button\b/g)).toHaveLength(1);
 expect(html).toContain('aria-label="입장하기"');
 expect(html).toContain('Authored exhibition');expect(html).not.toContain('관람권');expect(html).not.toContain('Public artist');expect(html).toContain('<time');
 const description=html.match(/aria-describedby="([^"]+)"/)?.[1];
 expect(description).toBeTruthy();expect(html).toContain(`id="${description}" class="publication-entry-ticket-body"`);
 expect(html).toContain('data-ticket-animation="false"');expect(html).not.toContain('disabled=""');
});
it('keeps busy and retry semantics and renders authored content as plain text',()=>{
 const html=renderToStaticMarkup(<EntryTicket title={'<img src="private" onerror="alert(1)">'} active animate unavailable buttonRef={null} onEnter={()=>{}}/>);
 expect(html).toContain('aria-label="3D 다시 시도 · 페이지 새로고침"');
 expect(html).toContain('disabled=""');expect(html).toContain('aria-busy="true"');
 expect(html).toContain('&lt;img');expect(html).not.toContain('<img');expect(html).not.toContain('<b>');
});

afterEach(()=>vi.useRealTimers());
it('shows the local calendar day and current minute with no seconds or UTC conversion',()=>{
 const date=new Date(2026,9,26,0,7,59);const local=localTicketMinute(date);
 expect(local).toEqual({date:'2026.10.26',minute:'00:07',dateTime:'2026-10-26T00:07'});
 vi.useFakeTimers();vi.setSystemTime(date);
 const html=renderToStaticMarkup(<EntryTicket title="Local exhibition" active={false} animate unavailable={false} buttonRef={null} onEnter={()=>{}}/>);
 expect(html).toContain('dateTime="2026-10-26T00:07"');expect(html).toContain('2026.10.26');expect(html).toContain('00:07');expect(html).not.toContain('00:07:59');
});
