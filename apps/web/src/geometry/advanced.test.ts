import {describe,it,expect} from 'vitest';
import {newDraft} from '../drafts/example';
import {createGeometryState,applyGeometryCommand} from './model';
import {curvedWall,staircase,ramp,appendArchitecture} from './advanced';
import {bundledTemplate,duplicateTemplate,validateTemplate,readTemplateFile} from './templates';
import {validateArchitecture,daylightDirection,DAYLIGHT_NAMESPACE,TEMPLATE_NAMESPACE} from '@exhibitos/studio-contract';
import {validateDraft} from '../drafts/validator';
import {newLight,kelvinColor} from '../placement/model';
import {createNavigationController} from '../viewer/navigation';
function base(){const e=newDraft().candidate;return applyGeometryCommand(createGeometryState(e),{type:'white-cube',roomId:e.rooms[0]!.id}).present;}
async function walk(doc:ReturnType<typeof base>,from:[number,number,number],yaw:number,seconds:number){const c=await createNavigationController(doc,{position:from});try{for(let i=0;i<seconds*60;i++)c.advance(1/60,{forward:1,right:0,yaw,paused:false});return c.state();}finally{c.dispose();}}
describe('advanced architecture uses the persisted renderer/physics geometry',()=>{
 it('preserves basic fixture, clones connected rooms with distinct IDs and attribution and validates round-trip',()=>{
 const target=newDraft().candidate,template=bundledTemplate(),copy=duplicateTemplate(template,target);validateTemplate(copy,true);
 expect(copy.rooms).toHaveLength(2);expect(copy.rooms[0]!.id).not.toBe(template.rooms[0]!.id);expect(copy.openings[0]!.connectsToOpeningId).toBe(copy.openings[1]!.id);expect(copy.id).toBe(target.id);expect(copy.navigation[0]!.waypoints[1]!.viaOpeningId).toBe(copy.openings[0]!.id);expect(copy.accessibility.routeIds[0]).toBe(copy.navigation[0]!.id);expect(copy.extensions![TEMPLATE_NAMESPACE]).toMatchObject({license:'CC0-1.0',modified:true,creator:'ExhibitOS contributors'});
 const d=newDraft();d.candidate=copy;d.exhibitionId=copy.id;expect(validateDraft(JSON.parse(JSON.stringify(d))).valid).toBe(true);expect(newDraft().candidate.extensions).toBeUndefined();
 const prose=bundledTemplate(),uuid=prose.rooms[0]!.id;prose.title=uuid;(prose.extensions![TEMPLATE_NAMESPACE] as unknown as {creator:string}).creator=uuid;const preserved=duplicateTemplate(prose,target);expect(preserved.title).toBe(uuid);expect((preserved.extensions![TEMPLATE_NAMESPACE] as unknown as {creator:string}).creator).toBe(uuid);
 });
 it('blocks absent, private and incompatible licensing for redistribution, keeps private editing possible, rejects artwork templates',()=>{
 const t=bundledTemplate();delete t.extensions![TEMPLATE_NAMESPACE];expect(()=>validateTemplate(t,true)).toThrow();
 const e=bundledTemplate(),p=e.extensions![TEMPLATE_NAMESPACE] as unknown as {license:string;profile:string};p.license='private';expect(()=>validateTemplate(e)).not.toThrow();expect(validateArchitecture(e,true).errors[0]!.code).toBe('TEMPLATE_REDISTRIBUTION_DENIED');p.license='CC-BY-4.0';expect(()=>validateTemplate(e,true)).not.toThrow();p.profile='unknown';expect(()=>validateTemplate(e)).toThrow();
 const personal=bundledTemplate();personal.extensions!['example.org/private']={secret:'retained private metadata'};expect(()=>validateTemplate(personal)).toThrow();const target=newDraft().candidate;target.annotations.push({id:crypto.randomUUID()} as unknown as typeof target.annotations[number]);expect(()=>duplicateTemplate(bundledTemplate(),target)).toThrow();
 });
 it('rejects impossible dimensions before mutating input, including unsupported steps and steep accessibility ramps',()=>{
 const d=base(),r=d.rooms[0]!,before=JSON.stringify(d);expect(()=>curvedWall(r,2,90,100,3)).toThrow();expect(()=>staircase(r,2,.3,.4,4)).toThrow();expect(()=>ramp(r,1,.5,2)).toThrow();expect(JSON.stringify(d)).toBe(before);
 });
 it('blocks curved chord walls with actual Rapier collision',async()=>{
 const d=base();const s=curvedWall(d.rooms[0]!,2,90,8,3);const e=appendArchitecture(d,s);const p=await walk(e,[0,1.65,0],Math.PI,3);expect(p.eyePosition[2]).toBeLessThan(1.8);expect(p.blocked).toBe(true);
 });
 it('climbs generated legal stair treads with real collision rather than visual-only stairs',async()=>{
 const d=base(),e=appendArchitecture(d,staircase(d.rooms[0]!,2,.2,.6,4));const p=await walk(e,[0,1.65,-1],Math.PI,2.4);expect(p.eyePosition[2]).toBeGreaterThan(1);expect(p.eyePosition[1]).toBeGreaterThan(2.1);
 });
 it('climbs a generated 1:12 continuous ramp and retains support',async()=>{
 const d=base(),e=appendArchitecture(d,ramp(d.rooms[0]!,2,.2,2.4));const p=await walk(e,[0,1.65,-1],Math.PI,2.2);expect(p.eyePosition[2]).toBeGreaterThan(1);expect(p.eyePosition[1]).toBeGreaterThan(1.7);expect(p.grounded).toBe(true);
 });
 it('qualifies real connected door navigation and refuses walking through an elevated window sill',async()=>{
 const d=bundledTemplate();const c=await createNavigationController(d,{position:[4,1.65,0]});try{expect(c.pathBetween([4,1.65,0],[14,1.65,0])).toBeDefined();for(let i=0;i<240;i++)c.advance(1/60,{forward:1,right:0,yaw:-Math.PI/2,paused:false});expect(c.state().eyePosition[0]).toBeGreaterThan(6);}finally{c.dispose();}
 const p=await walk(d,[0,1.65,-2],0,3);expect(p.eyePosition[2]).toBeGreaterThan(-3.8);expect(p.blocked).toBe(true);
 },30000);
 it('validates all artificial-light units and bounded visual Kelvin conversion',()=>{const draft=newDraft();for(const type of ['point','spot','directional','area'] as const){draft.candidate.lights=[newLight(draft.candidate.rooms[0]!.id,type)];expect(validateDraft(draft).valid).toBe(true);}expect(newLight(draft.candidate.rooms[0]!.id,'area').unit).toBe('lumen');const area=newLight(draft.candidate.rooms[0]!.id,'area');draft.candidate.lights=[area];for(const width of [1e-300,1e300]){area.dimensions!.width=width;expect(validateDraft(draft).valid).toBe(false);}expect(kelvinColor(6500)).toMatch(/^#[a-f0-9]{6}$/);expect(kelvinColor(2000)).not.toBe(kelvinColor(9000));expect(()=>kelvinColor(300)).toThrow();});
 it('cancels pending template reads on document edits or unmount without invoking replacement',async()=>{
 let finish!:(s:string)=>void;let current=true;const file={size:100,text:()=>new Promise<string>(resolve=>{finish=resolve;})};const pending=readTemplateFile(file,newDraft().candidate,()=>current);current=false;finish(JSON.stringify(bundledTemplate()));await expect(pending).rejects.toThrow('Draft changed');
 });
 it('bounds daylight, rejects impossible dates, and changes solar direction with date/time/orientation',()=>{
 const e=bundledTemplate(),d=e.extensions![DAYLIGHT_NAMESPACE] as unknown as Parameters<typeof daylightDirection>[0];expect(validateArchitecture(e).valid).toBe(true);const noon=daylightDirection(d);expect(noon[1]).toBeGreaterThan(0);expect(daylightDirection({...d,hour:0})[1]).toBeLessThan(0);expect(daylightDirection({...d,northDegrees:180})[2]).toBeCloseTo(-noon[2]);d.date='2026-02-30';expect(validateArchitecture(e).valid).toBe(false);
 });
});
