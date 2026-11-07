// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RuntimeHistoryDetails,historyIsOpen,historyKey,startDeploymentLookup,visibleDeployment} from './RuntimeHistoryDetails';

describe('runtime history display',()=>{
 it('shows unavailable facts without inventing a deployment time',()=>{
  const html=renderToStaticMarkup(<RuntimeHistoryDetails history={{runtimeVersion:null,sourceCommit:null,buildId:null,outputGeneratedAt:null,deployedAt:null}}/>);
  expect(html).toContain('Viewer 버전 확인할 수 없음');
  expect(html).toContain('Viewer 소스 버전 확인할 수 없음');
  expect(html).toContain('Viewer 빌드 식별자 확인할 수 없음');
  expect(html).toContain('출력 생성 시각 확인할 수 없음');
  expect(html).toContain('확인된 배포 시각 확인할 수 없음');
  expect(html).not.toContain('<time');
 });
 it('closes the effective history when either ancestor closes and ignores a late result',async()=>{
  expect(historyIsOpen(true,true,true)).toBe(true);
  expect(historyIsOpen(false,true,true)).toBe(false);
  expect(historyIsOpen(true,false,true)).toBe(false);
  let finish!:(value:string|null)=>void;const accepted:string[]=[];
  const cancel=startDeploymentLookup(()=>new Promise(resolve=>{finish=resolve;}),value=>{if(value)accepted.push(value);});
  cancel();finish('2026-11-07T10:00:00.000Z');await Promise.resolve();
  expect(accepted).toEqual([]);
 });
 it('never displays a result from another index even with the same exhibition revision',()=>{
  const a={indexSha256:'a'.repeat(64),publicationId:'p',revisionSha256:'r'};
  const b={...a,indexSha256:'b'.repeat(64)},result={key:historyKey(a),value:'2026-11-07T10:00:00.000Z'};
  expect(visibleDeployment(true,a,result)).toBe(result.value);
  expect(visibleDeployment(true,b,result)).toBeNull();
  expect(visibleDeployment(false,a,result)).toBeNull();
 });
 it('keeps source and output separate from verified deployment',()=>{
  const html=renderToStaticMarkup(<RuntimeHistoryDetails history={{runtimeVersion:'0.1.0',sourceCommit:'a'.repeat(40),buildId:'b'.repeat(64),outputGeneratedAt:'2026-11-07T10:00:00.000Z',deployedAt:null}}/>);
  expect(html).toContain('Viewer 버전 0.1.0');
  expect(html).toContain('a'.repeat(40));
  expect(html).toContain('dateTime="2026-11-07T10:00:00.000Z"');
  expect(html).toContain('확인된 배포 시각 확인할 수 없음');
 });
});
