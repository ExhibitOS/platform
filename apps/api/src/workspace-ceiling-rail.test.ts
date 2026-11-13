// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {qualifyWorkspaceFitGeometry} from './workspace-fit-geometry.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
import {createHash} from 'node:crypto';
const source=await readFile(new URL('./fixtures/rail-v11/linear-track.glb',import.meta.resolve('@exhibitos/spec')));
it('measures the original rail through the existing bounded worker rather than a hash eligibility list',async()=>{
 const geometry=qualifyWorkspaceFitGeometry(source,'passive-ceiling-rail-v1');expect(geometry).toEqual({profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]});
 const model={mime:'model/gltf-binary' as const,bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')};
 await expect(validateWorkspaceFurnishingGlb(model,source,{},'passive-ceiling-rail-v1')).resolves.toEqual(geometry);
 const changed=Buffer.from(source);changed[changed.length-1]=(changed[changed.length-1]??0)^1;expect(qualifyWorkspaceFitGeometry(changed,'passive-ceiling-rail-v1')).toBeDefined();
 await expect(validateWorkspaceFurnishingGlb({...model,sha256:'a'.repeat(64)},source,{},'passive-ceiling-rail-v1')).rejects.toMatchObject({code:'UPLOAD_INTEGRITY'});
});
