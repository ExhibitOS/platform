// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ViewingStyles} from './ViewingStyles';
const actions={setStyle:vi.fn(),step:vi.fn(),select:vi.fn(),cancel:vi.fn()};
const items=[{placementId:'a',title:'첫 작품',roomName:'첫 공간'},{placementId:'b',title:'둘째 작품',roomName:'둘째 공간'}];
it('keeps current and pending stops distinct and offers cancellation',()=>{
 const html=renderToStaticMarkup(<ViewingStyles state={{style:'ordered',currentPlacementId:'a',pendingPlacementId:'b',status:'preparing',message:'준비 중'}} items={items} actions={actions} available/>);
 expect(html).toContain('aria-current="step"');expect(html).toContain('현재 작품');expect(html).toContain('이동 준비 중');expect(html).toContain('이동 취소');expect(html).not.toContain('<img');
});
it('does not offer an unavailable ordered mode or invent a destination',()=>{
 const html=renderToStaticMarkup(<ViewingStyles state={{style:'free',status:'idle',message:''}} items={[]} actions={actions} available={false} variant="cover"/>);
 expect(html).toContain('순서대로 관람');expect(html).toContain('disabled');expect(html).not.toContain('다음 작품');expect(html).toContain('아직 준비되지 않았어요');
});
it('offers cancellation when the first ordered visit is still preparing',()=>{
 const html=renderToStaticMarkup(<ViewingStyles state={{style:'free',pendingStyle:'ordered',pendingPlacementId:'a',status:'preparing',message:'준비 중'}} items={items} actions={actions} available/>);
 expect(html).toContain('이동 준비 중');expect(html).toContain('이동 취소');expect(html).not.toContain('현재 작품');
});
