import type {Pool} from 'pg';
import type {ModelPreparationExecution,ModelPreparationWriter} from '../apps/api/src/model-preparation-import.ts';
import type {GpuModelPreparations} from '../apps/api/src/gpu-model-preparations.ts';
export function prepareNativeGpuModelRuntime(input:{pool:Pool;execution:ModelPreparationExecution;writer:ModelPreparationWriter;blobRoot:string;configRoot:string;payloadRoot:string}):Promise<{jobs:GpuModelPreparations;jobRoot:string}>;
export function assertNativeGpuModelDrained(pool:Pick<Pool,'query'>,jobRoot:string):Promise<void>;
