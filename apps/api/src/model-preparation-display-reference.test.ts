// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {preparedDisplayReference,validDisplayReference,type ProvisionalDisplayReference} from './model-preparation-display-reference.ts';
import type {CompactModelReceipt} from './oam-original-preparation.ts';
const source:ProvisionalDisplayReference={version:1,status:'provisional-uncalibrated',assetSha256:'a'.repeat(64),rawBounds:{min:[-.1,-1,-.2],max:[.1,1,.2]},referenceHeightMeters:1.5,pose:{position:[0,0,0],rotation:[0,0,0,1],scale:[.75,.75,.75]}};
const receipt=()=>({source:{sha256:source.assetSha256,bounds:{min:source.rawBounds.min.map(Math.fround),max:source.rawBounds.max.map(Math.fround)}},output:{sha256:'b'.repeat(64),bounds:{min:source.rawBounds.min.map(Math.fround),max:source.rawBounds.max.map(Math.fround)}}} as CompactModelReceipt);
it('binds actual display hash while retaining unknown-unit reference size, pose and source coordinates',()=>{
 const before=structuredClone(source),result=preparedDisplayReference(source,receipt());
 expect(result).toEqual({...source,assetSha256:'b'.repeat(64)});expect(source).toEqual(before);
 expect(validDisplayReference(result)).toBe(true);
});
it('refuses invented scale, source mismatch and coordinate change',()=>{
 for(const sourceChange of [{assetSha256:'c'.repeat(64)},{referenceHeightMeters:2},{pose:{...source.pose,rotation:[0,1,0,0]}}])expect(()=>preparedDisplayReference({...source,...sourceChange} as ProvisionalDisplayReference,receipt())).toThrow('MODEL_PREPARATION_DISPLAY_REFERENCE_INVALID');
 const altered=receipt();altered.output.bounds.max[0]=altered.output.bounds.max[0]!+0.01;
 expect(()=>preparedDisplayReference(source,altered)).toThrow('MODEL_PREPARATION_DISPLAY_REFERENCE_INVALID');
});
