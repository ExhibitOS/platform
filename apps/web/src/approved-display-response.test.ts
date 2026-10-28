// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {approvedDisplayCopyResponse} from './approved-display-response';
test('accepts truthful new clean/PNG-embedded and legacy markers, never contradictory or unsupported claims',()=>{
 const check=(h:Record<string,string>)=>approvedDisplayCopyResponse(new Headers({'content-type':'image/png',...h}));
 expect(check({'x-exhibitos-watermarked':'true'})).toBe(true);
 const clean={'x-exhibitos-display-copy':'true','x-exhibitos-watermark-mode':'none','x-exhibitos-watermarked':'false'};
 expect(check(clean)).toBe(true);expect(check({...clean,'content-type':'model/gltf-binary'})).toBe(true);
 const embedded={...clean,'x-exhibitos-watermark-mode':'embedded','x-exhibitos-watermarked':'true'};
 expect(check(embedded)).toBe(true);expect(check({...embedded,'content-type':'model/gltf-binary'})).toBe(false);
 const invalid:Record<string,string>[]=[{},{'x-exhibitos-watermarked':'false'},{...clean,'x-exhibitos-watermarked':'true'},{...embedded,'x-exhibitos-display-copy':'false'},{...clean,'x-exhibitos-watermark-mode':'overlay'}];
 for(const h of invalid)expect(check(h)).toBe(false);
});
