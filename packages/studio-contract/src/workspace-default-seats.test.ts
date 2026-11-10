// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {benchSolids} from './bench-geometry.js';
import {PRESENTATION_NAMESPACE,type StudioPresentation} from './index.js';
import {benchesFor,validateStudioBenches} from './benches.js';
import {USER_ASSET_CATALOGUE} from './user-asset-catalogue.js';
import {proposeWorkspaceDefaultSeats} from './workspace-default-seats.js';
import {WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from './workspace-furnishing.js';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(kind:'bench'|'stool',scale:number){
 const asset=USER_ASSET_CATALOGUE.find(row=>row.id===(kind==='stool'?'gallery-stool':'upholstered-gallery-bench'))!;
 const workspace:WorkspaceFurnishings={version:2,furnishings:[{
  id:id(2),version:1,kind,name:'Registered seat',rights:{},provenance:'Fixture',
  model:{mime:asset.mime,sha256:asset.sha256,bytes:asset.bytes},
 }],placements:[{id:id(3),roomId:id(1),furnishingId:id(2),furnishingVersion:1,position:[1,0,1],yaw:Math.PI/2,scale}]};
 return {rooms:[{id:id(1),dimensions:{width:12,depth:10,height:4},
  transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}}],
  extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:workspace,'org.example/retained':{value:true}},
 } as unknown as Exhibition;
}
const target={placementId:id(3),benchId:id(4),viewpointId:id(5)};

test.each([['bench',.1],['bench',4],['stool',.1],['stool',4]] as const)(
 'qualifies the %s at scale %s and preserves the existing seat on retry',(kind,scale)=>{
  const draft=fixture(kind,scale),snapshot=structuredClone(draft);
  const {candidate,additions:[row]}=proposeWorkspaceDefaultSeats(draft,[target]);
  expect(row).toBeDefined();
  expect(row!.bench.dimensions.width).toBeCloseTo((kind==='bench'?1.5:.38)*scale);
  expect(row!.viewpoint.position[1]).toBeCloseTo((kind==='bench'?.46:.45)*scale+.7);
  expect(row!.viewpoint.position[2]).toBeCloseTo(1+(kind==='bench'?.38*scale:0));
  expect(row!.viewpoint.target[0]).toBeCloseTo(-1);
  expect(row!.viewpoint.target[2]).toBeCloseTo(row!.viewpoint.position[2]);
  expect(draft).toEqual(snapshot);
  expect(benchSolids(candidate)).toHaveLength(5);
  expect(validateStudioBenches(candidate).valid).toBe(true);
  const presentation=candidate.extensions![PRESENTATION_NAMESPACE] as unknown as StudioPresentation;
  presentation.viewpoints[0]!.target=[0,1,2];
  const override=structuredClone(candidate);
  const retry=proposeWorkspaceDefaultSeats(candidate,[{...target,benchId:id(6),viewpointId:id(7)}]);
  expect(retry.additions).toEqual([]);
  expect(benchesFor(retry.candidate)).toEqual(benchesFor(candidate));
  expect(retry.candidate).toEqual(override);
 },
);

test('ignores unrelated model bytes and rejects duplicate targets',()=>{
 const draft=fixture('stool',1);
 const workspace=draft.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
 workspace.furnishings[0]!.model.bytes++;
 expect(proposeWorkspaceDefaultSeats(draft,[target]).additions).toEqual([]);
 expect(()=>proposeWorkspaceDefaultSeats(draft,[target,target])).toThrow('BENCH_REFERENCE');
});
