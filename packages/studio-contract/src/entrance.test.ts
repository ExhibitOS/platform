// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'vitest';
import { ENTRANCE_NAMESPACE, MAX_COVER_BYTES, entranceFor, entryPresentationFor, validateViewerEntrance } from './entrance';
const id = 'abcdefab-0000-4000-8000-000000000001';
const fixture = () => ({ artworks: [{ artworkType: 'image', primaryAssetId: id, assets: [{ id, role: 'image', mime: 'image/png', bytes: 1024 }] }],
  extensions: { [ENTRANCE_NAMESPACE]: { version: 1, artist: 'Artist', introduction: 'Public introduction', imageAssetId: id.toUpperCase(), imageAlt: 'A blue painting', mobilePosition: 'top' } } });
test('legacy exhibitions have a copy-safe default without an image request', () => {
  expect(validateViewerEntrance({})).toEqual({ valid: true, errors: [] });
  const value = entranceFor({}); value.artist = 'Changed';
  expect(entranceFor({})).toMatchObject({ artist: '', mobilePosition: 'center' });
  expect(entranceFor({})).not.toHaveProperty('imageAssetId');
});
test('public cover accepts a unique primary PNG reference case-insensitively and preserves the source', () => {
  const candidate = fixture(), original = JSON.stringify(candidate);
  expect(validateViewerEntrance(candidate).valid).toBe(true);
  const cover = entranceFor(candidate); cover.introduction = 'Changed';
  expect(JSON.stringify(candidate)).toBe(original);
});
test.each(['privateUrl', 'autoplay', 'token'])('unknown entrance field %s is rejected', field => {
  const candidate = fixture(); Object.assign(candidate.extensions[ENTRANCE_NAMESPACE], { [field]: 'forbidden' });
  expect(validateViewerEntrance(candidate).valid).toBe(false);
});
test.each([null, 1, ['center'], { toString: null, valueOf: null }])('non-string mobile position is rejected without coercion or exceptions: %j', mobilePosition => {
  const candidate = fixture(); Object.assign(candidate.extensions[ENTRANCE_NAMESPACE], { mobilePosition });
  expect(validateViewerEntrance(candidate)).toMatchObject({ valid: false });
});
test('cover rejects missing or ambiguous inventory, GLB, oversized images and empty alt', () => {
  const missing = fixture(); missing.artworks = []; expect(validateViewerEntrance(missing).valid).toBe(false);
  const duplicate = fixture(); duplicate.artworks.push(structuredClone(duplicate.artworks[0]!)); expect(validateViewerEntrance(duplicate).valid).toBe(false);
  const glb = fixture(); glb.artworks[0]!.assets[0]!.mime = 'model/gltf-binary'; expect(validateViewerEntrance(glb).valid).toBe(false);
  const oversized = fixture(); oversized.artworks[0]!.assets[0]!.bytes = MAX_COVER_BYTES + 1; expect(validateViewerEntrance(oversized).valid).toBe(false);
  const noAlt = fixture(); noAlt.extensions[ENTRANCE_NAMESPACE].imageAlt = '  '; expect(validateViewerEntrance(noAlt).valid).toBe(false);
});
test('text poster remains valid without an image and bounded metadata rejects future versions', () => {
  const candidate = fixture(); Reflect.deleteProperty(candidate.extensions[ENTRANCE_NAMESPACE], 'imageAssetId');
  expect(validateViewerEntrance(candidate).valid).toBe(true);
  candidate.extensions[ENTRANCE_NAMESPACE].version = 2;
  expect(validateViewerEntrance(candidate).valid).toBe(false);
});
test('legacy presentation defaults are copy-safe and do not rewrite a saved document',()=>{
  const candidate=fixture(),before=JSON.stringify(candidate),settings=entryPresentationFor(candidate);
  expect(settings).toEqual({ticketTitle:'',ticketDetail:'',ticketAnimation:true,coverUnfold:true,doorEffect:true});
  settings.ticketAnimation=false;settings.ticketTitle='Changed';
  expect(entryPresentationFor({}).ticketAnimation).toBe(true);
  expect(JSON.stringify(candidate)).toBe(before);
});
test('all independent authored effect combinations and public ticket prose survive save/reopen',()=>{
  for(let mask=0;mask<8;mask++){
    const candidate=fixture(),presentation={ticketTitle:mask===0?'😀'.repeat(80):id,ticketDetail:'Plain <b>public</b> text',ticketAnimation:!!(mask&1),coverUnfold:!!(mask&2),doorEffect:!!(mask&4)};
    Object.assign(candidate.extensions[ENTRANCE_NAMESPACE],{presentation});
    Object.assign(candidate.extensions,{'private.example/retained':{keep:'raw'}});
    const before=JSON.stringify(candidate);
    expect(validateViewerEntrance(candidate).valid).toBe(true);
    const reopened=JSON.parse(JSON.stringify(candidate));
    expect(entryPresentationFor(reopened)).toEqual(presentation);
    entryPresentationFor(reopened).doorEffect=true;
    expect(entryPresentationFor(candidate)).toEqual(presentation);
    expect(JSON.stringify(candidate)).toBe(before);
  }
});
test('invalid/future presentation settings are rejected without stripping original data',()=>{
  const valid={ticketTitle:'Title',ticketDetail:'Detail',ticketAnimation:true,coverUnfold:true,doorEffect:true};
  for(const presentation of [null,{}, {...valid,version:2},{...valid,ticketTitle:'x'.repeat(161)},{...valid,ticketTitle:'😀'.repeat(81)},{...valid,ticketDetail:'x'.repeat(513)},{...valid,ticketDetail:'😀'.repeat(257)},...['ticketAnimation','coverUnfold','doorEffect'].flatMap(key=>[0,null,'true'].map(value=>({...valid,[key]:value})))]){
    const candidate=fixture();Object.assign(candidate.extensions[ENTRANCE_NAMESPACE],{presentation});
    const before=JSON.stringify(candidate);expect(validateViewerEntrance(candidate).valid).toBe(false);
    expect(()=>entryPresentationFor(candidate)).toThrow('VIEWER_ENTRANCE_INVALID');expect(JSON.stringify(candidate)).toBe(before);
  }
});
