import {afterEach,expect,it,vi} from 'vitest';
import {createDiagnosticEvents,diagnosticsEnabled,readDiagnosticSnapshot,registerDiagnosticSource,type DiagnosticSnapshot} from './diagnostic-source';

afterEach(()=>vi.unstubAllGlobals());
it('is disabled outside explicit staging and fences source teardown',()=>{
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',false);
 const one=()=>({version:1} as DiagnosticSnapshot),two=()=>({version:1} as DiagnosticSnapshot);
 expect(diagnosticsEnabled()).toBe(false);registerDiagnosticSource(one);expect(readDiagnosticSnapshot()).toBeNull();
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',true);
 const release=registerDiagnosticSource(one);registerDiagnosticSource(two);release();expect(readDiagnosticSnapshot()).toEqual({version:1});
});
it('retains only 64 bounded safe event tokens',()=>{
 vi.stubGlobal('__EXHIBITOS_STAGING_DIAGNOSTICS__',true);const buffer=createDiagnosticEvents();
 const event={atMs:0,assetId:'11111111-1111-4111-8111-111111111111',artworkRevisionId:null,stage:'fetch-verify',errorCode:null};
 for(let n=0;n<70;n++)buffer.record({...event,atMs:n});
 buffer.record({...event,stage:'https://example.test/?token=secret'});
 buffer.record({...event,errorCode:'PRIVATE URL'});
 expect(buffer.snapshot()).toHaveLength(64);expect(buffer.snapshot()[0]?.atMs).toBe(6);expect(buffer.snapshot().at(-1)?.atMs).toBe(69);
});
