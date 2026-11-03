// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {publicationTime} from './publication-time';
const at=(value:unknown,timeZone:string)=>publicationTime(value,{locale:'en-GB',timeZone});
test('keeps the publication instant while browser zones cross a calendar boundary',()=>{
 const raw='2026-11-02T20:49:13.623Z',berlin=at(raw,'Europe/Berlin'),seoul=at(raw,'Asia/Seoul');
 expect(berlin).toMatchObject({kind:'instant',dateTime:raw,timeZone:'Europe/Berlin',utcOffset:'UTC+01:00'});expect(berlin.text).toContain('02/11/2026');expect(berlin.text).toContain('21:49');
 expect(seoul).toMatchObject({dateTime:raw,utcOffset:'UTC+09:00'});expect(seoul.text).toContain('03/11/2026');expect(seoul.text).toContain('05:49');expect(seoul.text).not.toContain('13.623');
 expect(at('2026-11-03T05:49:13.623+09:00','Europe/Berlin').text).toBe(berlin.text);
 expect(at(raw,'UTC').utcOffset).toBe('UTC+00:00');
});
test('offset follows the instant through a DST gap and repeated local hour',()=>{
 const springBefore=at('2026-03-29T00:30:00Z','Europe/Berlin'),springAfter=at('2026-03-29T01:30:00Z','Europe/Berlin');
 expect(springBefore.text).toContain('01:30');expect(springBefore.utcOffset).toBe('UTC+01:00');expect(springAfter.text).toContain('03:30');expect(springAfter.utcOffset).toBe('UTC+02:00');
 const fallBefore=at('2026-10-25T00:30:00Z','Europe/Berlin'),fallAfter=at('2026-10-25T01:30:00Z','Europe/Berlin');
 expect(fallBefore.text).toContain('02:30');expect(fallAfter.text).toContain('02:30');expect(fallBefore.utcOffset).toBe('UTC+02:00');expect(fallAfter.utcOffset).toBe('UTC+01:00');
});
test('date-only and zoneless values never acquire a fabricated instant or zone',()=>{
 for(const zone of ['Europe/Berlin','Asia/Seoul']){
  expect(at('2026-11-02',zone)).toEqual({kind:'date',text:'2026-11-02',dateTime:'2026-11-02'});
  expect(at('2026-11-02T20:49:13.623',zone)).toEqual({kind:'unspecified',text:'2026-11-02 20:49 (시간대 정보 없음)',dateTime:'2026-11-02T20:49:13.623'});
 }
});
test('missing, invalid and calendar-overflow inputs never become now or Invalid Date',()=>{
 for(const value of [undefined,null,'',0,'yesterday','2026-02-30','2026-02-30T10:00Z','2026-11-02T24:00Z','2026-11-02T12:60Z','2026-11-02T12:30+24:00'])expect(at(value,'Europe/Berlin')).toEqual({kind:'unavailable',text:'시간 정보 없음'});
 expect(at('2024-02-29','Asia/Seoul').kind).toBe('date');
});
test('formatter failure preserves the explicit source offset without claiming local conversion',()=>{
 const raw='2026-11-03T05:49:13.623+09:00',value=at(raw,'Unknown/Zone');expect(value).toEqual({kind:'instant',dateTime:raw,text:'2026-11-03T05:49+09:00 (기록된 시간대 · 현지 시간 변환 불가)'});
 expect(publicationTime(raw,{locale:'bad_locale',timeZone:'Asia/Seoul'})).toEqual(value);
});
