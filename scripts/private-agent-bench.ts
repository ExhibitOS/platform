// SPDX-License-Identifier: AGPL-3.0-or-later
import {checkedFrame} from '../apps/web/src/native-viewport-protocol';
import {nativeBenchInspectorCandidate} from '../apps/web/src/native-bench-inspector';
import {catalogBinding} from '../apps/web/src/native-catalog-protocol';
import type {BenchInspectorRequest} from '../apps/web/src/native-bench-inspector';
import type {NativeViewportFrame} from '../apps/web/src/native-viewport-protocol';
export function benchProposal(frame:NativeViewportFrame,request:BenchInspectorRequest){
 frame=checkedFrame(frame);const candidate=nativeBenchInspectorCandidate(frame,request);
 return {...catalogBinding(request),benchId:request.type==='remove-bench'?request.benchId:request.bench.id,candidate};
}
