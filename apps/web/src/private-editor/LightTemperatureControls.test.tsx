// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {lightDetailsFor,lightKelvinLinear,setLightDetails,setLightAttachment,lightAttachmentPose,lightAttachmentsFor,LIGHT_DETAILS_NAMESPACE,TEMPLATE_NAMESPACE} from '@exhibitos/studio-contract';
import {createGeometryState,applyGeometryCommand,undoGeometry,redoGeometry} from '../geometry/model';
import {newLight} from '../placement/model';
import type {PublicPublication} from '../publication-client';
import {privateSeed,starterDraft,starterRoom,checkPrivateCandidate} from './model';
import {onlyLightColorChanged} from '../geometry/light-preview';
import {LightTemperatureControls,lightTemperatureCommand} from './LightTemperatureControls';

function fixture(){
 const root=new URL('../../../../demos/reference-exhibition/source/',import.meta.url),index=JSON.parse(readFileSync(new URL('static-publication-index.json',root),'utf8'));
 const source:PublicPublication={...JSON.parse(readFileSync(new URL(index.publication.path,root),'utf8')),local:{kind:'static',fetcher:async()=>{throw Error('No asset IO');},check:async()=>{}}};
 source.exhibition.extensions={...source.exhibition.extensions,'org.example/kept':{value:'original'}};
 const original=structuredClone(source.exhibition),seed=privateSeed(source,'a'.repeat(64)),draft=starterDraft(seed),room=starterRoom(draft.candidate),ceiling=draft.candidate.surfaces.find(s=>s.roomId===room.id&&s.type==='ceiling')!,light=newLight(room.id),binding={lightId:light.id,surfaceId:ceiling.id,anchor:[.3,.2] as [number,number],gap:.08};
 light.transform=lightAttachmentPose(ceiling,binding);
 let document=applyGeometryCommand(createGeometryState(draft.candidate),{type:'add-light',light}).present;
 const {id,...value}=light;document=setLightDetails(document,id,value,{fixture:'disc',range:12,aim:{kind:'rotation'}});document=setLightAttachment(document,id,binding);
 return {seed,source,original,document,lightId:id};
}
it('changes only explicit color intent and preserves attachments, source, settings and reversible private history',()=>{
 const f=fixture(),before=structuredClone(f.document),initial=createGeometryState(f.document),next=applyGeometryCommand(initial,lightTemperatureCommand(f.document,f.lightId,'4000.25'));
 const light=next.present.lights.find(l=>l.id===f.lightId)!,old=before.lights.find(l=>l.id===f.lightId)!;
 expect(light).toEqual({...old,color:lightKelvinLinear(4000.25)});expect(lightDetailsFor(next.present).find(l=>l.lightId===f.lightId)).toEqual({...lightDetailsFor(before).find(l=>l.lightId===f.lightId),temperatureKelvin:4000.25});
 expect(lightAttachmentsFor(next.present)).toEqual(lightAttachmentsFor(before));expect(next.present.extensions?.['org.example/kept']).toEqual(before.extensions?.['org.example/kept']);checkPrivateCandidate(f.seed,next.present);
 expect(undoGeometry(next).present).toEqual(initial.present);expect(redoGeometry(undoGeometry(next)).present).toEqual(next.present);expect(f.document).toEqual(before);expect(f.source.exhibition).toEqual(f.original);
});
it('rejects empty, nonfinite and out-of-range input without changing the current document',()=>{
 const f=fixture(),before=structuredClone(f.document);
 for(const raw of ['',' ','NaN','Infinity','999','20001'])expect(()=>lightTemperatureCommand(f.document,f.lightId,raw)).toThrow('LIGHT_TEMPERATURE_INVALID');
 expect(()=>lightTemperatureCommand(f.document,'missing','4000')).toThrow('LIGHT_DETAILS_REFERENCE');expect(f.document).toEqual(before);
 for(const raw of ['1000','20000'])expect(()=>applyGeometryCommand(createGeometryState(f.document),lightTemperatureCommand(f.document,f.lightId,raw))).not.toThrow();
});
it('does not infer or write a Kelvin value when displaying a custom color and labels disabled controls',()=>{
 const f=fixture(),before=structuredClone(f.document),html=renderToStaticMarkup(<LightTemperatureControls document={f.document} lightId={f.lightId} disabled execute={()=>{throw Error('render must not edit');}} error={()=>{}}/>);
 expect(html).toContain('직접 지정한 색상');expect(html).toContain('색온도 (K)');expect(html).toContain('aria-describedby=');expect(html).toContain('<fieldset disabled=');expect(html).toContain('step="any"');expect(f.document).toEqual(before);
});

it('retains scene equivalence for real Kelvin commands, original metadata and one-step history',()=>{
 const f=fixture();
 for(const legacy of [false,true]){
  const before=structuredClone(f.document);
  if(legacy)delete before.extensions![LIGHT_DETAILS_NAMESPACE];
  before.extensions={...before.extensions,[TEMPLATE_NAMESPACE]:{version:1,name:'Synthetic room',creator:'ExhibitOS',license:'CC0-1.0',source:'https://example.com/synthetic-room',modified:false,profile:'oes-rectangles-v1'}};
  const initial=createGeometryState(before),next=applyGeometryCommand(initial,lightTemperatureCommand(before,f.lightId,'3500.123456789'));
  expect(onlyLightColorChanged(initial.present,next.present)).toBe(true);
  const undone=undoGeometry(next),redone=redoGeometry(undone);
  expect(onlyLightColorChanged(next.present,undone.present)).toBe(true);expect(onlyLightColorChanged(undone.present,redone.present)).toBe(true);
  expect(undone.present).toEqual(before);expect(lightAttachmentsFor(next.present)).toEqual(lightAttachmentsFor(before));
 }
 const matching=structuredClone(f.document);delete matching.extensions![LIGHT_DETAILS_NAMESPACE];matching.lights.find(l=>l.id===f.lightId)!.color=lightKelvinLinear(4000.25);
 const next=applyGeometryCommand(createGeometryState(matching),lightTemperatureCommand(matching,f.lightId,'4000.25'));
 expect(onlyLightColorChanged(matching,next.present)).toBe(true);expect(onlyLightColorChanged(next.present,undoGeometry(next).present)).toBe(true);
});
