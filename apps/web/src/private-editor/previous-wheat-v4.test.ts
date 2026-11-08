import {expect,it} from 'vitest';
import {isSupportedPreviousWheatV4,PREVIOUS_HAYES_WHEAT_V4_INDEX,PREVIOUS_WHEAT_V4_INDEX} from './previous-wheat-v4.mjs';

it('admits only the two exact formerly public v4 archive indices',()=>{
 expect(isSupportedPreviousWheatV4(PREVIOUS_WHEAT_V4_INDEX)).toBe(true);
 expect(isSupportedPreviousWheatV4(PREVIOUS_HAYES_WHEAT_V4_INDEX)).toBe(true);
 expect(isSupportedPreviousWheatV4('0'.repeat(64))).toBe(false);
 expect(isSupportedPreviousWheatV4(PREVIOUS_HAYES_WHEAT_V4_INDEX.toUpperCase())).toBe(false);
 expect(isSupportedPreviousWheatV4(undefined)).toBe(false);
});
