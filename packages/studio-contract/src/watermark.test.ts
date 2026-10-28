// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {validateStudioPresentation,presentationFor} from './index.js';
import {watermarkFor,watermarkLabel,normalizeDisplayWatermark,validDisplayWatermark,embeddedWatermarkTextSupported,WATERMARK_CAPABILITIES} from './watermark.js';
test('absent and explicit none use a clean new-output default without mutating existing presentation',()=>{
 const candidate={title:'전시',extensions:{'org.exhibitos.studio/presentation':{version:1,credits:'Required credit',viewpoints:[]}}},before=JSON.stringify(candidate);
 expect(watermarkFor(candidate)).toEqual({version:1,mode:'none'});expect(validateStudioPresentation(candidate).valid).toBe(true);expect(JSON.stringify(candidate)).toBe(before);
 expect(normalizeDisplayWatermark({version:1,mode:'none',text:'Unused',size:24})).toEqual({version:1,mode:'none'});expect(presentationFor(candidate).credits).toBe('Required credit');
});
test('bounded overlay and image embedding remain optional independent display treatments',()=>{
 const setting={version:1,mode:'overlay',text:'작가 · 출처',position:'top-left',size:16,opacity:.3};
 const candidate={extensions:{'org.exhibitos.studio/presentation':{version:1,credits:'Original rights notice',viewpoints:[],watermark:setting}}};
 expect(validateStudioPresentation(candidate).valid).toBe(true);expect(watermarkLabel(candidate)).toBe('작가 · 출처');expect(watermarkFor(candidate)).toEqual(setting);
 expect(WATERMARK_CAPABILITIES.embeddedGlb).toBe(false);expect(embeddedWatermarkTextSupported('Author / CC0')).toBe(true);expect(embeddedWatermarkTextSupported('한글')).toBe(false);
 for(const bad of [{...setting,mode:'unknown'},{...setting,size:25},{...setting,opacity:0},{...setting,text:'bad\nlabel'},{...setting,rightsOverride:true}])expect(validDisplayWatermark(bad)).toBe(false);
});
