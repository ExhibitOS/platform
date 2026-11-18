// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {modularBaseboardFixture} from '../test-fixtures/modular-baseboard.js';
import {validateWorkspaceFurnishings} from './workspace-furnishing.js';
import {applyArchitecturalFinishCommand,architecturalWallBoxes,architecturalSolids,plainBaseboardPortalFeet,remapArchitecturalFinishes,validateArchitecturalFinishes,ARCHITECTURAL_FINISH_NAMESPACE as N} from './architectural-finishes.js';
const overlap=(a:{min:number[];max:number[]},b:{min:number[];max:number[]})=>[0,1,2].every(i=>Math.min(a.max[i]!,b.max[i]!)-Math.max(a.min[i]!,b.min[i]!)>1e-9);
const bounds=(b:ReturnType<typeof architecturalWallBoxes>[number])=>({min:b.position.map((n,i)=>n-[b.dimensions.width,b.dimensions.height,b.dimensions.depth][i]!/2),max:b.position.map((n,i)=>n+[b.dimensions.width,b.dimensions.height,b.dimensions.depth][i]!/2)});
it('keeps absent and false plain bands off and generates only the selected lower band without a portal',()=>{
 const f=modularBaseboardFixture();delete f.document.extensions!['org.exhibitos.studio/workspace-furnishings'];const before=structuredClone(f.document),old=architecturalWallBoxes(f.wall,f.document.openings,f.settings);
 expect(architecturalWallBoxes(f.wall,f.document.openings,{...f.settings,plainBaseboard:false})).toEqual(old);
 const settings={...f.settings,ceilingBand:true,plainBaseboard:true},next=applyArchitecturalFinishCommand(f.document,{type:'set-wall-finish',wall:settings}),boxes=architecturalWallBoxes(f.wall,next.openings,settings,true,next),bottom=-f.wall.dimensions.height/2;
 expect(boxes.filter(b=>b.kind==='structure')).toEqual(old);expect(boxes.filter(b=>b.kind==='finish')).toHaveLength(4);
 for(const b of boxes.filter(b=>b.kind==='finish')){expect(bounds(b).min[1]).toBeCloseTo(bottom,12);expect(bounds(b).max[1]).toBeCloseTo(bottom+.04,12);expect(overlap(bounds(b),{min:[f.opening.offset[0]-.7,bottom,-1],max:[f.opening.offset[0]+.7,bottom+2.6,1]})).toBe(false);}
 expect(architecturalWallBoxes(f.wall,next.openings,settings,false,next)).toEqual(old);expect(architecturalSolids(next,()=>false).every(s=>s.kind==='structure')).toBe(true);expect(f.document).toEqual(before);
 expect(remapArchitecturalFinishes({version:1,walls:[settings]},new Map([[f.wall.id.toLowerCase(),crypto.randomUUID()]] )).walls[0]!.plainBaseboard).toBe(true);
 expect(JSON.parse(JSON.stringify(next)).extensions[N].walls[0].plainBaseboard).toBe(true);
});
it.each([false,true])('cuts only source-qualified modular feet for paired=%s while retaining the aperture and source metadata',paired=>{
 const f=modularBaseboardFixture(paired),before=structuredClone(f.document),settings={...f.settings,plainBaseboard:true};expect(validateWorkspaceFurnishings(f.document)).toEqual({valid:true,errors:[]});const next=applyArchitecturalFinishCommand(f.document,{type:'set-wall-finish',wall:settings});
 expect(validateArchitecturalFinishes(next)).toEqual({valid:true,errors:[]});
 const boxes=architecturalWallBoxes(f.wall,next.openings,settings,true,next),feet=plainBaseboardPortalFeet(next,f.wall.id),old=architecturalWallBoxes(f.wall,f.document.openings,f.settings);
 expect(feet).toHaveLength(4);expect(boxes.filter(b=>b.kind==='structure')).toEqual(old);
 for(const b of boxes.filter(b=>b.kind==='finish'))for(const foot of feet)expect(overlap(bounds(b),foot)).toBe(false);
 const front=boxes.filter(b=>b.kind==='finish'&&b.position[2]>0);expect(front).toHaveLength(2);
 expect(bounds(front[0]!).max[0]).toBeCloseTo(f.opening.offset[0]-f.opening.dimensions.width/2-.04,12);expect(bounds(front[1]!).min[0]).toBeCloseTo(f.opening.offset[0]+f.opening.dimensions.width/2+.04,12);
 expect(next.surfaces).toEqual(before.surfaces);expect(next.openings).toEqual(before.openings);expect(next.extensions!['org.exhibitos.studio/workspace-furnishings']).toEqual(before.extensions!['org.exhibitos.studio/workspace-furnishings']);expect(f.document).toEqual(before);
 expect(architecturalSolids(next).filter(s=>s.surfaceId===f.wall.id&&s.kind==='finish')).toHaveLength(boxes.filter(b=>b.kind==='finish').length);
});
it('fails closed for missing context and invalid opt-in fields',()=>{
 const f=modularBaseboardFixture(),settings={...f.settings,plainBaseboard:true};expect(()=>architecturalWallBoxes(f.wall,f.document.openings,settings)).toThrow('PLAIN_BASEBOARD_CONTEXT_REQUIRED');
 for(const change of [{plainBaseboard:'true'},{plainBaseboard:1},{plainBaseboard:null},{plainBaseboard:true,preset:'painted-edge'},{plainBaseboard:true,extra:true}]){
  const d=structuredClone(f.document);d.extensions![N]={version:1,walls:[{...settings,...change}]} as never;expect(validateArchitecturalFinishes(d).valid).toBe(false);
 }
});
it.each(['ambiguous','source-digest','unqualified-part','unsupported-profile','legacy-opening-visual'] as const)('does not guess portal feet for %s',kind=>{
 const f=modularBaseboardFixture();
 if(kind==='ambiguous')f.workspace.openingAttachments!.push(structuredClone(f.workspace.openingAttachments![0]!));
 if(kind==='source-digest')f.workspace.furnishings[0]!.fit!.sourceSha256='b'.repeat(64);
 if(kind==='unqualified-part'){const g=f.workspace.furnishings[0]!.fit!.geometry;if(g.profile!=='modular-portal-v1')throw Error('fixture');g.parts['front-left'].min[0]-=.01;}
 if(kind==='unsupported-profile')delete f.workspace.furnishings[0]!.fit;
 if(kind==='legacy-opening-visual')f.document.extensions!['org.exhibitos.studio/furnishing-visuals']={bindings:[{hostKind:'opening',hostId:f.opening.id}]} as never;
 const before=structuredClone(f.document);expect(()=>applyArchitecturalFinishCommand(f.document,{type:'set-wall-finish',wall:{...f.settings,plainBaseboard:true}})).toThrow('ARCHITECTURAL_FINISH_INVALID');expect(f.document).toEqual(before);
});
