// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RuntimeHistoryDetails} from './RuntimeHistoryDetails';

describe('runtime history display',()=>{
 it('shows unavailable facts without inventing a deployment time',()=>{
  const html=renderToStaticMarkup(<RuntimeHistoryDetails history={{runtimeVersion:null,sourceCommit:null,outputGeneratedAt:null,deployedAt:null}}/>);
  expect(html).toContain('Viewer 버전 확인할 수 없음');
  expect(html).toContain('Viewer 소스 버전 확인할 수 없음');
  expect(html).toContain('출력 생성 시각 확인할 수 없음');
  expect(html).toContain('확인된 배포 시각 확인할 수 없음');
  expect(html).not.toContain('<time');
 });
 it('keeps source and output separate from verified deployment',()=>{
  const html=renderToStaticMarkup(<RuntimeHistoryDetails history={{runtimeVersion:'0.1.0',sourceCommit:'a'.repeat(40),outputGeneratedAt:'2026-11-07T10:00:00.000Z',deployedAt:null}}/>);
  expect(html).toContain('Viewer 버전 0.1.0');
  expect(html).toContain('a'.repeat(40));
  expect(html).toContain('dateTime="2026-11-07T10:00:00.000Z"');
  expect(html).toContain('확인된 배포 시각 확인할 수 없음');
 });
});
