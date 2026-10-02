// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {ARTWORK_DETAILS_NAMESPACE,creationYearFor,validateArtworkDetails} from './artwork-details.js';
describe('authored artwork creation year',()=>{
 it('preserves absent legacy namespace and never substitutes publication timestamps',()=>{const artwork={createdAt:'2026-10-02T00:00:00Z'};expect(validateArtworkDetails(artwork).valid).toBe(true);expect(creationYearFor(artwork)).toBeUndefined();});
 it('accepts bounded authored integer years only',()=>{for(const creationYear of [1,2024,9999]){const a={extensions:{[ARTWORK_DETAILS_NAMESPACE]:{version:1,creationYear}}};expect(validateArtworkDetails(a).valid).toBe(true);expect(creationYearFor(a)).toBe(creationYear);}for(const value of [{version:1,creationYear:0},{version:1,creationYear:10000},{version:1,creationYear:2024.1},{version:1,creationYear:'2024'},{version:1,creationYear:NaN},{version:2,creationYear:2024},{version:1,creationYear:2024,privateNote:'private'}]){const a={extensions:{[ARTWORK_DETAILS_NAMESPACE]:value}};expect(validateArtworkDetails(a).valid).toBe(false);expect(creationYearFor(a)).toBeUndefined();}});
});
