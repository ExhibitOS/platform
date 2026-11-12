// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {REFINED_BENCH,REFINED_BENCH_COLLISION_BOXES} from './refined-bench.js';
import type {StudioFurnishings} from './furnishings.js';
import type {AffinePoint} from './artifact-affine.js';
import type {StudioBench} from './benches.js';
export interface BenchBox { position: AffinePoint; dimensions: {width:number;height:number;depth:number} }
/** Five boxes for a slab; two more for a backed. All presets share one box geometry. */
export function benchBoxes(bench: StudioBench, scale=1,document?:Pick<Exhibition,'extensions'>): BenchBox[] {
  // Fixed catalogue proxies only; no caller-defined shapes or model inference.
  const value=document?.extensions?.['org.exhibitos.studio/furnishing-visuals'] as unknown as StudioFurnishings|undefined;
  const binding=value?.bindings?.find(row=>row.hostKind==='bench'&&row.hostId.toLowerCase()===bench.id.toLowerCase());
  const asset=binding&&value?.assets?.find(row=>row.id===binding.assetId&&row.catalogId===REFINED_BENCH.id&&row.sha256===REFINED_BENCH.sha256);
  if(asset&&binding&&Number.isFinite(binding.pose.scale)&&binding.pose.scale>=.1&&binding.pose.scale<=4){
    const s=binding.pose.scale;return REFINED_BENCH_COLLISION_BOXES.map(box=>({position:box.position.map(n=>n*s) as AffinePoint,dimensions:{width:box.dimensions.width*s,height:box.dimensions.height*s,depth:box.dimensions.depth*s}}));
  }
  const {width:w,depth:d,height:h}=bench.dimensions, thickness=.06*scale, leg=.06*scale;
  const boxes:BenchBox[]=[{position:[0,h-thickness/2,0],dimensions:{width:w,height:thickness,depth:d}}];
  for(const x of [-1,1])for(const z of [-1,1])boxes.push({position:[x*(w/2-leg), (h-thickness)/2, z*(d/2-leg)],dimensions:{width:leg,height:h-thickness,depth:leg}});
  if(bench.kind==='backed'){
    boxes.push({position:[0,h+.22,d/2-.03],dimensions:{width:w,height:.36,depth:.06}});
    boxes.push({position:[0,h+.02,d/2-.03],dimensions:{width:w,height:.04,depth:.06}});
  }
  return boxes;
}
