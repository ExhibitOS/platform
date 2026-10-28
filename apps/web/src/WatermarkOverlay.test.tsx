// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Exhibition} from '@exhibitos/spec';
import {WatermarkOverlay} from './WatermarkOverlay';
test('overlay is escaped Unicode DOM only; none/embedded and historical absence add no screen treatment',()=>{
 const candidate={title:'전시',extensions:{'org.exhibitos.studio/presentation':{version:1,viewpoints:[],credits:'Required full credit',watermark:{version:1,mode:'overlay',text:'작가 <img src=x>',position:'bottom-left',size:12,opacity:.25}}}} as unknown as Exhibition,before=JSON.stringify(candidate);
 const html=renderToStaticMarkup(<WatermarkOverlay candidate={candidate}/>);expect(html).toContain('작가 &lt;img src=x&gt;');expect(html).toContain('data-position="bottom-left"');expect(html).not.toContain('<img');expect(html).not.toContain('<canvas');expect(JSON.stringify(candidate)).toBe(before);
 for(const mode of ['none','embedded']){const copy=structuredClone(candidate);(copy.extensions!['org.exhibitos.studio/presentation'] as {watermark:unknown}).watermark={version:1,mode};expect(renderToStaticMarkup(<WatermarkOverlay candidate={copy}/>)).toBe('');}
 expect(renderToStaticMarkup(<WatermarkOverlay candidate={{title:'Old',extensions:{}} as Exhibition}/>)).toBe('');
});
