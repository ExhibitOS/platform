import {expect,it} from 'vitest';
import {createDiagnosticReport} from './diagnostic-report';
import type {DiagnosticSnapshot} from './diagnostic-source';

const publicationId='11111111-1111-4111-8111-111111111111', artworkRevisionId='22222222-2222-4222-8222-222222222222';
const first='33333333-3333-4333-8333-333333333333', second='44444444-4444-4444-8444-444444444444',revisionSha256='a'.repeat(64);
const snapshot={version:1,capturedAt:'2026-11-08T00:00:00.000Z',lifecycle:'live',identity:{publicationId,revisionSha256,indexSha256:null,buildId:null,sourceCommit:null},
 selected:{placementId:first,artworkRevisionId,reason:'detail'},displayed:{artworkRevisionId,assetId:null,sha256:'b'.repeat(64),tier:'acquired-original'},
 device:{deviceMemoryGiB:null,coarsePointer:true,finePointer:false,pixelRatio:1,viewportWidth:390,viewportHeight:800,budget:{maxCacheBytes:1,maxTransitionBytes:2,maxTextureSize:512,maxTriangles:20000,effectiveResidentBytes:1,effectiveTransitionBytes:2,selectedDetailResidentBytes:3,selectedDetailTransitionBytes:4,originalDetailSceneBytes:5,originalDetailTransitionBytes:6}},
 navigation:null,memory:{residentEstimateBytes:null,transitionEstimateBytes:null,peakTransitionEstimateBytes:null,textureEstimateBytes:null,meshEstimateBytes:null,peakTextureEstimateBytes:null,peakMeshEstimateBytes:null,renderTargetEstimateBytes:null,peakRenderTargetEstimateBytes:null,gpuPhysicalBytes:null},assets:[],events:[]} as DiagnosticSnapshot;
const report=(placementId:string)=>JSON.parse(createDiagnosticReport(snapshot,{publicationId,revisionSha256,detail:{placementId,artworkRevisionId}}));
it('recognizes an observed acquired original by verified hash without an asset id',()=>{
 const result=report(first);expect(result.requestedDetail.attachment).toBe('observed');expect(result.snapshot.displayed.tier).toBe('acquired-original');expect(result.snapshot.device.budget.originalDetailSceneBytes).toBe(5);
});
it('does not project another placement display or its detail limits',()=>{
 const result=report(second);expect(result.requestedDetail.attachment).toBe('not-observed');expect(result.snapshot.displayed.tier).toBeNull();expect(result.snapshot.device.budget.selectedDetailResidentBytes).toBeNull();expect(result.snapshot.device.budget.originalDetailSceneBytes).toBeNull();expect(result.snapshot.device.budget.originalDetailTransitionBytes).toBeNull();
});
it.each(['detail-lightweight','detail-approved'] as const)('reports a committed %s asset with its verified identity',tier=>{
 const displayed={artworkRevisionId,assetId:first,sha256:'b'.repeat(64),tier};
 const expected={publicationId,revisionSha256,detail:{placementId:first,artworkRevisionId}};
 const result=JSON.parse(createDiagnosticReport({...snapshot,displayed},expected));
 expect(result.requestedDetail.attachment).toBe('observed');
 expect(result.snapshot.displayed).toEqual(displayed);
});
it('requires a valid original hash or a rendered detail asset id to mark attachment observed',()=>{
 const expected={publicationId,revisionSha256,detail:{placementId:first,artworkRevisionId}};
 for(const displayed of [
  {...snapshot.displayed,sha256:null},
  {...snapshot.displayed,sha256:'invalid'},
  {...snapshot.displayed,tier:'detail-approved' as const,sha256:'b'.repeat(64)},
  {...snapshot.displayed,tier:'scene' as const,assetId:first},
 ]) expect(JSON.parse(createDiagnosticReport({...snapshot,displayed},expected)).requestedDetail.attachment).toBe('not-observed');
});

it('keeps selected detail stages in order within the existing event cap',()=>{
 const decision={atMs:1,assetId:first,artworkRevisionId,stage:'promotion-requested',errorCode:null};
 const transfer={...decision,atMs:40,stage:'fetch-verify'};
 const recent=Array.from({length:63},(_,i)=>({atMs:i+32,assetId:second,artworkRevisionId:second,stage:'queued',errorCode:null}));
 const events=[...recent,transfer].sort((a,b)=>a.atMs-b.atMs);
 const expected={publicationId,revisionSha256,detail:{placementId:first,artworkRevisionId}};
 const result=JSON.parse(createDiagnosticReport({...snapshot,events,selectedDetailEvents:[decision,transfer]},expected));
 expect(result.snapshot.events).toHaveLength(64);
 expect(result.snapshot.events[0]).toEqual(decision);
 expect(result.snapshot.events.filter((event:typeof transfer)=>event.assetId===first)).toEqual([decision,transfer]);
 expect(result.snapshot.events.map((event:typeof transfer)=>event.atMs)).toEqual([1,40,...recent.slice(1).map(event=>event.atMs)].sort((a,b)=>a-b));
});

it('keeps scoped events only for the matching live placement and revision',()=>{
 const decision={atMs:1,assetId:first,artworkRevisionId,stage:'promotion-requested',errorCode:null};
 const recent={atMs:2,assetId:second,artworkRevisionId:second,stage:'queued',errorCode:null};
 const current={...snapshot,events:[recent],selectedDetailEvents:[decision]};
 for(const [source,detail] of [
  [current,undefined],
  [current,{placementId:second,artworkRevisionId}],
  [current,{placementId:first,artworkRevisionId:second}],
  [{...current,lifecycle:'stopped' as const},{placementId:first,artworkRevisionId}],
 ] as const) {
  const result=JSON.parse(createDiagnosticReport(source,{publicationId,revisionSha256,detail}));
  expect(result.snapshot.events).toEqual([recent]);
 }
});

it('sanitizes selected stages and excludes unrelated revisions',()=>{
 const event={atMs:1,assetId:first,artworkRevisionId,stage:'promotion-requested',errorCode:'unsafe https://example.invalid'};
 const result=JSON.parse(createDiagnosticReport({...snapshot,selectedDetailEvents:[
  event,
  {...event,assetId:'unsafe'},
  {...event,stage:'unsafe stage'},
  {...event,artworkRevisionId:second},
 ]},{publicationId,revisionSha256,detail:{placementId:first,artworkRevisionId}}));
 expect(result.snapshot.events).toEqual([{...event,errorCode:null}]);
});

it('projects only the three byte counts from a model decode refusal',()=>{
 const reservation={existingBytes:40,requestedBytes:30,limitBytes:60,privateField:'omit'};
 const event={atMs:1,assetId:first,artworkRevisionId,stage:'model-decode-reservation-refused',errorCode:'ASSET_TRANSITION_PEAK',reservation};
 const events=[event,{...event,atMs:2,reservation:{...reservation,existingBytes:-1}},{...event,atMs:3,stage:'queued'}];
 const result=JSON.parse(createDiagnosticReport({...snapshot,events},{publicationId,revisionSha256}));
 expect(result.snapshot.events.map((value:{reservation?:unknown})=>value.reservation)).toEqual([
  {existingBytes:40,requestedBytes:30,limitBytes:60},undefined,undefined,
 ]);
});
