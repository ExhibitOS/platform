// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {declareFootstepFamily} from './footstep-authoring';
const key='org.exhibitos.viewer/footstep-resources';
test('an explicit sound choice adds one canonical family and preserves earlier choices',()=>{
 const doc={extensions:{}} as unknown as Exhibition;
 declareFootstepFamily(doc,'wood');declareFootstepFamily(doc,'concrete');declareFootstepFamily(doc,'wood');
 expect(doc.extensions?.[key]).toEqual({version:1,families:['concrete','wood']});
});
test('an invalid existing declaration is not silently replaced',()=>{
 const doc={extensions:{[key]:{version:2,families:['wood']}}} as unknown as Exhibition,before=structuredClone(doc);
 expect(()=>declareFootstepFamily(doc,'concrete')).toThrow('FOOTSTEP_RESOURCE_SELECTION');expect(doc).toEqual(before);
});
