import {afterEach,expect,it,vi} from 'vitest';
import {createDiagnosticEvents,diagnosticsEnabled,readDiagnosticSnapshot,registerDiagnosticSource,type DiagnosticSnapshot} from './diagnostic-source';

afterEach(()=>vi.unstubAllGlobals());
it('is disabled outside explicit staging and fences source teardown',()=>{
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',false);
 const identity={publicationId:'p',revisionSha256:'r'};
 const one=()=>({version:1,identity} as DiagnosticSnapshot),two=()=>({version:1,identity} as DiagnosticSnapshot);
 expect(diagnosticsEnabled()).toBe(false);registerDiagnosticSource(one);expect(readDiagnosticSnapshot(identity)).toBeNull();
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',true);
 const release=registerDiagnosticSource(one),releaseTwo=registerDiagnosticSource(two);release();expect(readDiagnosticSnapshot(identity)).toEqual({version:1,identity});expect(readDiagnosticSnapshot({...identity,revisionSha256:'other'})).toBeNull();releaseTwo();expect(readDiagnosticSnapshot(identity)).toBeNull();
});
it('reports a pending modal without borrowing another attended artwork',()=>{
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',true);
 const identity={publicationId:'p',revisionSha256:'r'};
 const snapshot={version:1,identity,selected:{placementId:null,artworkRevisionId:'other',reason:'attended'},displayed:{artworkRevisionId:'other',assetId:'asset',sha256:'a'.repeat(64),tier:'scene'}} as DiagnosticSnapshot;
 const release=registerDiagnosticSource(()=>snapshot);
 const result=readDiagnosticSnapshot({...identity,detail:{placementId:'placement',artworkRevisionId:'wanted'}});
 expect(result).toEqual(snapshot);release();
});
it('does not confuse two placements of the same artwork',()=>{
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',true);
 const identity={publicationId:'p',revisionSha256:'r'};
 const snapshot={version:1,identity,selected:{placementId:'first',artworkRevisionId:'art',reason:'detail'},displayed:{artworkRevisionId:'art',assetId:'asset',sha256:null,tier:'detail-approved'}} as DiagnosticSnapshot;
 const release=registerDiagnosticSource(()=>snapshot);
 expect(readDiagnosticSnapshot({...identity,detail:{placementId:'second',artworkRevisionId:'art'}})).toEqual(snapshot);
 expect(readDiagnosticSnapshot({...identity,detail:{placementId:'first',artworkRevisionId:'art'}})?.displayed.tier).toBe('detail-approved');release();
});
it('retains only 64 bounded safe event tokens',()=>{
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',true);const buffer=createDiagnosticEvents();
 const event={atMs:0,assetId:'11111111-1111-4111-8111-111111111111',artworkRevisionId:null,stage:'fetch-verify',errorCode:null};
 for(let n=0;n<70;n++)buffer.record({...event,atMs:n});
 buffer.record({...event,stage:'https://example.test/?token=secret'});
 buffer.record({...event,errorCode:'PRIVATE URL'});
 expect(buffer.snapshot()).toHaveLength(64);expect(buffer.snapshot()[0]?.atMs).toBe(6);expect(buffer.snapshot().at(-1)?.atMs).toBe(69);
});

it('retains one scoped decision and recent exact stages independently of gallery churn',()=>{
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',true);
 const buffer=createDiagnosticEvents();
 const assetId='11111111-1111-4111-8111-111111111111',revisionId='22222222-2222-4222-8222-222222222222';
 const selected={atMs:0,assetId,artworkRevisionId:revisionId,stage:'promotion-wait-retry',errorCode:null};
 buffer.beginSelected(revisionId,[assetId]);
 buffer.decision(selected);
 buffer.decision({...selected,stage:'promotion-request-eligible'});
 for(let n=1;n<=20;n++)buffer.record({...selected,atMs:n,stage:'fetch-verify'});
 buffer.record({...selected,atMs:21,stage:'failed',errorCode:'ASSET_TRANSITION_PEAK'});
 for(let n=22;n<90;n++)buffer.record({...selected,atMs:n,artworkRevisionId:null});
 expect(buffer.snapshot()).toHaveLength(64);
 expect(buffer.snapshot().every(event=>event.artworkRevisionId===null)).toBe(true);
 const trace=buffer.selectedSnapshot();
 expect(trace).toHaveLength(16);
 expect(trace?.[0]).toEqual(selected);
 expect(trace?.at(-1)).toMatchObject({stage:'failed',errorCode:'ASSET_TRANSITION_PEAK'});
 buffer.beginSelected('33333333-3333-4333-8333-333333333333',[assetId]);
 buffer.record(selected);
 expect(buffer.selectedSnapshot()).toEqual([]);
 buffer.clearSelected();
 expect(buffer.selectedSnapshot()).toBeUndefined();
});
