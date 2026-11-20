// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {
 BENCH_NAMESPACE,FURNISHING_NAMESPACE,PRESENTATION_NAMESPACE,freezeCanonical,furnishingAsset,
 validateFurnishings,validateStudioBenches,validateStudioPresentation,
 type StudioBenches,type StudioFurnishings,type StudioPresentation,
} from '@exhibitos/studio-contract';
import {ApiError} from './auth.ts';
import {readFurnishingBytes} from './furnishing-assets.ts';

const benchId='fb830fdb-e45d-48a8-8a81-c95f47f0976e';
const viewpointId='81dfaa68-ee2a-4dcf-8505-cc33fefa3ce0';
const visualId='bb2b5419-38e9-419b-bbae-dbcab3656b16';
const acceptedWheatScene='1f103fe942c434d526de2e88ec35f2967a4c0bc53f1ebaa0d639b5fddb5b4658';
const acceptedBenchScene='523088eaacc522e2946e9356fd786a15d2336cea1777ac348547a6cd81a1141a';
const unavailable=():never=>{throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');};
const sceneHash=(scene:Exhibition)=>createHash('sha256').update(freezeCanonical(scene)).digest('hex');

function extensions(scene:Exhibition){
 const benches=scene.extensions?.[BENCH_NAMESPACE] as StudioBenches|undefined;
 const presentation=scene.extensions?.[PRESENTATION_NAMESPACE] as StudioPresentation|undefined;
 const furnishings=scene.extensions?.[FURNISHING_NAMESPACE] as StudioFurnishings|undefined;
 if(!benches||!presentation||!furnishings)return unavailable();
 return {benches,presentation,furnishings};
}

function removeOne<T>(rows:T[],matches:(row:T)=>boolean):T{
 const index=rows.findIndex(matches);
 if(index<0||rows.findLastIndex(matches)!==index)return unavailable();
 return rows.splice(index,1)[0]!;
}

export async function projectSelectedPaintingBench(selected:Exhibition,before:Exhibition,saved:Exhibition):Promise<Exhibition>{
 if(sceneHash(selected)!==acceptedWheatScene)return unavailable();
 const retained=structuredClone(saved);
 const source=extensions(retained);
 const bench=removeOne(source.benches.benches,row=>row.id===benchId);
 const viewpoint=removeOne(source.presentation.viewpoints,row=>row.id===viewpointId);
 const visual=removeOne(source.furnishings.assets,row=>row.id===visualId);
 const binding=removeOne(source.furnishings.bindings,row=>row.hostKind==='bench'&&row.hostId===benchId&&row.assetId===visualId);
 if(!isDeepStrictEqual(retained,before)||!isDeepStrictEqual(visual,furnishingAsset(visualId,'backless-oak-bench')))return unavailable();

 const next=structuredClone(selected);
 const target=extensions(next);
 target.benches.benches.push(bench);
 target.presentation.viewpoints.push(viewpoint);
 target.furnishings.assets.push(visual);
 target.furnishings.bindings.push(binding);
 if(sceneHash(next)!==acceptedBenchScene||!validateStudioBenches(next).valid||
    !validateStudioPresentation(next).valid||!validateFurnishings(next).valid)return unavailable();

 await readFurnishingBytes(visual,'model');
 await readFurnishingBytes(visual,'notice');
 return next;
}
