// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {framePreparationPair,prepareExactFrame} from './frame-preparation.ts';

it('refuses unrelated or incomplete source bytes',()=>{
 expect(framePreparationPair({bytes:101768,sha256:'0'.repeat(64)})).toBeUndefined();
 expect(()=>prepareExactFrame(Buffer.from('glTF'))).toThrow('FRAME_PREPARATION_UNSAFE');
});

const input=process.env.EXHIBITOS_FRAME_PREPARATION_INPUT_DIR;
it.skipIf(!input)('reproduces all three source-bound registered candidates without modifying source',async()=>{
 for(const id of ['black-aluminum-frame','brushed-silver-frame','natural-oak-flat-frame']){
  const path=join(input!,id,'visual.glb'),source=await readFile(path),before=Buffer.from(source);
  const result=prepareExactFrame(source),expected=await readFile(new URL(`../test-fixtures/${id}-tangent-r1/model.glb`,import.meta.url));
  expect(result.bytes.equals(expected)).toBe(true);expect(source.equals(before)).toBe(true);
  expect((await readFile(path)).equals(before)).toBe(true);
  const altered=Buffer.from(source);altered[altered.length-1]=altered[altered.length-1]!^1;
  expect(()=>prepareExactFrame(altered)).toThrow('FRAME_PREPARATION_UNSAFE');
 }
});
