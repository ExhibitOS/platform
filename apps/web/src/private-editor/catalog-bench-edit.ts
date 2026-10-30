// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {applyBenchCommand,applyFurnishingCommand} from '@exhibitos/studio-contract';
import {privateCatalogBench} from './catalog-bench-renderer';

/** Remove the selected visual and its functional host together; history belongs to the caller. */
export function removeCatalogBench(document:Exhibition,benchId:string):Exhibition {
 const selected=privateCatalogBench(document);
 if(!selected||selected.binding.hostId.toLowerCase()!==benchId.toLowerCase())throw Error('BENCH_REFERENCE');
 const withoutVisual=applyFurnishingCommand(document,{type:'remove-furnishing-visual',hostKind:'bench',hostId:benchId});
 return applyBenchCommand(withoutVisual,{type:'remove-bench',benchId});
}
