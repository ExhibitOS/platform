// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect, test} from 'vitest';
import {MATERIAL_NAMESPACE, surfaceTextureDefaults} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {checkedFrame, nativeGeometryAction} from './native-viewport-protocol';
import {surfaceTextureProposal} from '../../../scripts/private-agent-surface';

function sample() {
  const draft = newDraft();
  let frame = checkedFrame({version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:false,disabled:false});
  frame.draft.candidate = nativeGeometryAction(frame,{type:'white-cube',roomId:draft.candidate.rooms[0]!.id});
  const surfaceId = frame.draft.candidate.surfaces.find(s=>s.type==='wall')!.id;
  const material = {color:'#aabbcc',roughness:.4,metalness:.1};
  frame.draft.candidate = nativeGeometryAction({...frame,selection:{kind:'surface',id:surfaceId}},{type:'set-material',surfaceId,material});
  frame = checkedFrame({...frame,selection:{kind:'surface',id:surfaceId}});
  const request = {type:'set-material-texture' as const,surfaceId,material,texture:surfaceTextureDefaults('fine-gallery-concrete').texture,version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID()};
  return {frame,request};
}

test('native surface proposal changes only the selected texture and keeps the scalar material',()=>{
  const {frame,request}=sample(),before=structuredClone(frame),reply=surfaceTextureProposal(frame,request);
  expect(Object.keys(reply).sort()).toEqual(['candidate','epoch','principalId','requestId','sequence','surfaceId','tenantId','version']);
  expect(reply.surfaceId).toBe(request.surfaceId);
  const expected=structuredClone(frame.draft.candidate);
  const materials=expected.extensions![MATERIAL_NAMESPACE] as {surfaces:Record<string,unknown>;surfaceTextures?:Record<string,unknown>};
  materials.surfaceTextures={[request.surfaceId]:request.texture};
  expect(reply.candidate).toEqual(expected);
  expect(materials.surfaces[request.surfaceId]).toEqual(request.material);
  expect(frame).toEqual(before);
});

test('stale, foreign, malformed or wrongly selected proposals are rejected',()=>{
  const {frame,request}=sample();
  for(const bad of [{...request,sequence:2},{...request,tenantId:crypto.randomUUID()},{...request,extra:true},{...request,surfaceId:crypto.randomUUID()},{...request,texture:{...request.texture,normalScale:99}}])
    expect(()=>surfaceTextureProposal(frame,bad)).toThrow();
  expect(()=>surfaceTextureProposal({...frame,disabled:true},request)).toThrow();
});
