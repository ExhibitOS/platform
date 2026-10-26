// SPDX-License-Identifier: AGPL-3.0-or-later
import type {AffinePoint} from './artifact-affine.js';
import type {StudioBench} from './benches.js';
export interface BenchBox { position: AffinePoint; dimensions: {width:number;height:number;depth:number} }
/** Five boxes for a slab; two more for a backed. All presets share one box geometry. */
export function benchBoxes(bench: StudioBench): BenchBox[] {
  const {width:w,depth:d,height:h}=bench.dimensions, thickness=.06, leg=.06;
  const boxes:BenchBox[]=[{position:[0,h-thickness/2,0],dimensions:{width:w,height:thickness,depth:d}}];
  for(const x of [-1,1])for(const z of [-1,1])boxes.push({position:[x*(w/2-leg), (h-thickness)/2, z*(d/2-leg)],dimensions:{width:leg,height:h-thickness,depth:leg}});
  if(bench.kind==='backed'){
    boxes.push({position:[0,h+.22,d/2-.03],dimensions:{width:w,height:.36,depth:.06}});
    boxes.push({position:[0,h+.02,d/2-.03],dimensions:{width:w,height:.04,depth:.06}});
  }
  return boxes;
}
