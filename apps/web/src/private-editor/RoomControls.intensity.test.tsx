// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Exhibition} from '@exhibitos/spec';
import {newLight} from '../placement/model';
import {PrivateLightIntensity} from './RoomControls';

type Light=Exhibition['lights'][number];
function render(light:Light|undefined,value:string,disabled=false){
 const onChange=vi.fn(),onApply=vi.fn(),before=structuredClone(light);
 const html=renderToStaticMarkup(<PrivateLightIntensity light={light} value={value} disabled={disabled} onChange={onChange} onApply={onApply}/>);
 expect(light).toEqual(before);expect(onChange).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();return html;
}

it.each([
 ['point','candela','cd','칸델라'],['spot','candela','cd','칸델라'],['area','lumen','lm','루멘'],['directional','lux','lx','럭스'],
] as const)('labels the declared unit of %s light without converting retained fractional intensity', (type,unit,symbol,name)=>{
 const light=newLight('11111111-1111-4111-8111-111111111111',type),raw='1234.123456789';light.intensity=Number(raw);
 expect(light.unit).toBe(unit);const html=render(light,raw);
 expect(html).toContain(`밝기 (${symbol})`);expect(html).toContain(`aria-description="단위: ${name} (${symbol})"`);
 expect(html).toContain(`aria-valuetext="1234 ${name}"`);expect(html).toContain(`aria-label="밝기 1234 ${name}"`);
 expect(html).toContain(`>1234 ${symbol}</output>`);expect(html).toContain(`max="${raw}"`);expect(html).toContain(`value="${raw}"`);expect(html).toContain('step="any"');
});

it('keeps editable zero and fractional text intact and follows the declared unit rather than guessing from light type',()=>{
 const light=newLight('11111111-1111-4111-8111-111111111111','point');light.unit='lumen';
 for(const [raw,shown,spoken] of [['0','0','0'],['0.000000123','1.23e-7','1.23 곱하기 10의 마이너스 7제곱'],['003.12500','3.125','3.125']]){
  const html=render(light,raw);expect(html).toContain('밝기 (lm)');expect(html).toContain(`>${shown} lm</output>`);expect(html).toContain(`aria-valuetext="${spoken} 루멘"`);expect(light.intensity).toBe(100);
 }
});

it('announces invalid editing without relabeling or changing the retained intensity',()=>{
 const light=newLight('11111111-1111-4111-8111-111111111111');light.intensity=74.125;
 for(const raw of ['',' ','NaN','-1','Infinity']){
  const html=render(light,raw);expect(html).toContain('aria-valuetext="입력한 밝기를 확인하세요."');expect(html).toContain('수치 확인 필요 cd</output>');expect(html).toContain('value="74.125"');
 }
});

it('keeps unsupported unit text explicit and escaped, and leaves missing-light controls disabled',()=>{
 const light={...newLight('11111111-1111-4111-8111-111111111111'),unit:'watt<script>'} as unknown as Light;
 const html=render(light,'42.125',true);expect(html).toContain('밝기 (단위: watt&lt;script&gt;)');expect(html).toContain('지원하지 않는 단위: watt&lt;script&gt;');expect(html).not.toContain('밝기 (cd)');expect(html).toContain('disabled=""');
 const missing=render(undefined,'100');expect(missing).toContain('단위 정보 없음');expect(missing).not.toContain('밝기 ()');expect(missing).toMatch(/<input[^>]*disabled=""/);expect(missing).toMatch(/<button disabled=""/);
});
