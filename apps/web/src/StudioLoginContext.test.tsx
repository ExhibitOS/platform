import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Studio} from './Studio';
import {Cms} from './Cms';
const tenantId='11111111-1111-4111-8111-111111111111';
afterEach(()=>vi.unstubAllGlobals());
describe('real Studio header and CMS first login context',()=>{
 it('keeps the selected installation in the main header link and prefills ordinary CMS inputs',()=>{
  vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('window',{location:{href:`http://127.0.0.1:13200/studio?localTenant=${tenantId}&localSubject=chosen-owner`}});
  const html=renderToStaticMarkup(<Studio/>);expect(html).toContain(`href="/cms?localTenant=${tenantId}&amp;localSubject=chosen-owner">작품 관리</a>`);
  const cms=renderToStaticMarkup(<Cms/>);expect(cms).toContain(`value="${tenantId}"`);expect(cms).toContain('value="chosen-owner"');expect(cms).toContain('type="password"');expect(cms).not.toContain('localPassword');
 });
 it('keeps the independent manual CMS header route when hints are unavailable',()=>{
  vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('window',{location:{href:'https://independent.invalid/studio'}});
  expect(renderToStaticMarkup(<Studio/>)).toContain('href="/cms">작품 관리</a>');
 });
});
