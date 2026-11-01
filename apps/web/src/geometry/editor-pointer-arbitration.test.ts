// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {EditorPointerArbitration} from './editor-pointer-arbitration';

describe('editor pointer arbitration',()=>{
 it('suppresses selection after a second physical contact until a fresh canvas gesture',()=>{
  const a=new EditorPointerArbitration();expect(a.down(1,true)).toBe(false);expect(a.down(2,false)).toBe(true);expect(a.suppressSelection).toBe(true);
  a.up(2);a.up(1);expect(a.busy).toBe(false);expect(a.suppressSelection).toBe(true);
  a.down(3,false);expect(a.down(4,true)).toBe(true);a.up(3);a.up(4);expect(a.suppressSelection).toBe(true);
  expect(a.down(5,true)).toBe(false);expect(a.suppressSelection).toBe(false);
 });
 it('counts cross-device and outside contacts by ID, without treating repeated down as a new touch',()=>{
  const a=new EditorPointerArbitration();a.down(7,false);expect(a.down(7,true)).toBe(false);expect(a.down(9,true)).toBe(true);expect(a.multiple).toBe(true);a.up(7);expect(a.busy).toBe(true);a.up(9);expect(a.busy).toBe(false);
 });
 it('clears lost contacts on lifecycle reset without reviving the old click',()=>{
  const a=new EditorPointerArbitration();a.down(1,true);a.clear();expect(a.busy).toBe(false);expect(a.suppressSelection).toBe(true);a.up(1);expect(a.suppressSelection).toBe(true);
  a.down(2,false);expect(a.down(3,true)).toBe(true);a.up(2);a.up(3);expect(a.suppressSelection).toBe(true);a.down(4,true);expect(a.suppressSelection).toBe(false);
 });
});
