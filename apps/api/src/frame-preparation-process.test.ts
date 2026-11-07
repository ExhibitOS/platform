// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareFrameInWorker} from './frame-preparation-process.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
import {framePreparationPair} from './frame-preparation.ts';
import {sha256} from '@exhibitos/storage';

const input=process.env.EXHIBITOS_FRAME_PREPARATION_INPUT_DIR;
it.skipIf(!input)('isolates the exact source preparation and strictly validates each result',async()=>{
 for(const id of ['black-aluminum-frame','brushed-silver-frame','natural-oak-flat-frame']){
  const source=await readFile(join(input!,id,'visual.glb')),pair=framePreparationPair({bytes:source.length,sha256:sha256(source)});
  expect(pair).toBeDefined();const derived=await prepareFrameInWorker(source);
  expect(derived.equals(await readFile(new URL(`../test-fixtures/${id}-tangent-r1/model.glb`,import.meta.url)))).toBe(true);
  await expect(validateWorkspaceFurnishingGlb(pair!.renderable,derived)).resolves.toBeUndefined();
 }
 await expect(prepareFrameInWorker(Buffer.from('unrelated'))).rejects.toMatchObject({code:'FRAME_PREPARATION_UNSAFE'});
});
