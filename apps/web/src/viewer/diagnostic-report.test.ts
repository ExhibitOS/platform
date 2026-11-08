import {expect,it} from 'vitest';
import {createDiagnosticReport} from './diagnostic-report';
import type {DiagnosticHayesTransitionFrame,DiagnosticSnapshot} from './diagnostic-source';

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
it('requires a valid original hash or an approved asset id to mark attachment observed',()=>{
 const expected={publicationId,revisionSha256,detail:{placementId:first,artworkRevisionId}};
 for(const displayed of [
  {...snapshot.displayed,sha256:null},
  {...snapshot.displayed,sha256:'invalid'},
  {...snapshot.displayed,tier:'detail-approved' as const,sha256:'b'.repeat(64)},
  {...snapshot.displayed,tier:'scene' as const,assetId:first},
 ]) expect(JSON.parse(createDiagnosticReport({...snapshot,displayed},expected)).requestedDetail.attachment).toBe('not-observed');
});

it('retains bounded per-asset outcomes independently of recent events', () => {
 const stage = {
  assetId: first, artworkRevisionId, atMs: 10, stage: 'deferred-resident-budget',
  errorCode: 'RESIDENT_BUDGET', residentUsedBytes: 100,
  residentCandidateBytes: 50, residentLimitBytes: 125,
 };
 const render = {
  ...stage, assetId: second, stage: 'display-attached-render-returned',
  errorCode: 'https://example.invalid/?secret=value', residentCandidateBytes: -1,
  renderOutcome: 'returned' as const,
 };
 const lastAssetStages = [stage, render, ...Array.from({length: 31}, () => stage)];
 const json = createDiagnosticReport({...snapshot, lastAssetStages}, {publicationId, revisionSha256});
 const result = JSON.parse(json);
 expect(result.snapshot.events).toEqual([]);
 expect(result.snapshot.lastAssetStages).toHaveLength(32);
 expect(result.snapshot.lastAssetStages[0]).toMatchObject(stage);
 expect(result.snapshot.lastAssetStages[1]).toMatchObject({
  renderOutcome: 'returned', errorCode: null, residentCandidateBytes: null,
 });
 expect(result.metrics.assetRenderOutcome).toContain('visible pixels are unverified');
 expect(json).not.toContain('secret');
});

it('projects only bounded main-scene mesh submission fields on retained render returns', () => {
 const submission = {
  drawCalls: 0,
  cameraPosition: [6, 1.65, -5] as [number, number, number],
  cameraQuaternion: [0, 0, 0, 1] as [number, number, number, number],
  verticalFov: 48,
  worldBounds: {min: [5, 1, -5] as [number, number, number], max: [6, 2, -4] as [number, number, number]},
 };
 const render = {assetId: first, artworkRevisionId, atMs: 10, stage: 'display-attached-render-returned', errorCode: null};
 const lastAssetStages = [
  {...render, mainMeshSubmission: {...submission, debugPath: '/secret'}},
  {...render, mainMeshSubmission: {...submission, drawCalls: 2, worldBounds: null}},
  {...render, mainMeshSubmission: {...submission, cameraPosition: [0, Infinity, 0] as [number, number, number]}},
  {...render, mainMeshSubmission: {...submission, worldBounds: {...submission.worldBounds, max: [1, 2, 3] as [number, number, number]}}},
  {...render, mainMeshSubmission: null},
  {...render, stage: 'attached-awaiting-draw', mainMeshSubmission: submission},
  render,
 ];
 const json = createDiagnosticReport({...snapshot, lastAssetStages}, {publicationId, revisionSha256});
 const fields = JSON.parse(json).snapshot.lastAssetStages.map((row: {mainMeshSubmission?: unknown}) => row.mainMeshSubmission);
 expect(fields).toEqual([
  submission,
  {...submission, drawCalls: 2, worldBounds: null},
  null,
  {...submission, worldBounds: null},
  null,
  undefined,
  undefined,
 ]);
 expect(json).not.toContain('/secret');
});

it('distinguishes no transition-frame target from zero Hayes callbacks and rejects invalid pairs', () => {
 const firstFrame = {
  atMs: 12.5, attachmentGeneration: null, assetId: null, drawCalls: null,
  cameraPosition: [4.2, 1.65, -7] as [number, number, number],
  cameraQuaternion: [0, 0, 0, 1] as [number, number, number, number],
  verticalFov: 48, worldBounds: null,
 };
 const latestFrame = {
  ...firstFrame, atMs: 48.5, attachmentGeneration: 1,
  assetId: '5062b496-cfaa-44ee-9e07-8c3e154d1024', drawCalls: 0,
  worldBounds: {min: [5, 1, -5] as [number, number, number], max: [6, 2, -4] as [number, number, number]},
 };
 const project = (first: DiagnosticHayesTransitionFrame,
  latest: DiagnosticHayesTransitionFrame) =>
  createDiagnosticReport({...snapshot, hayesTransitionFrames:{first,latest}}, {publicationId, revisionSha256});
 const withDebugPath = {...latestFrame, debugPath:'/secret'};
 const json = project(firstFrame, withDebugPath);
 expect(JSON.parse(json).snapshot.hayesTransitionFrames).toEqual({first:firstFrame,latest:latestFrame});
 expect(json).not.toContain('/secret');
 for (const invalid of [
  {...latestFrame, assetId:first},
  {...latestFrame, attachmentGeneration:null},
  {...latestFrame, atMs:11},
  {...latestFrame, verticalFov:Infinity},
  {...latestFrame, worldBounds:{...latestFrame.worldBounds, max:[1, 2, 3] as [number, number, number]}},
  {...firstFrame, drawCalls:0},
 ]) expect(JSON.parse(project(firstFrame, invalid)).snapshot).not.toHaveProperty('hayesTransitionFrames');
});
