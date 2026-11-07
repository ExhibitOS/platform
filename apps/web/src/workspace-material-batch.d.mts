export interface MaterialBatchRecord {materialId:string;version:number;role:'color'|'normal'|'roughness';sha256:string;bytes:number}
export const MATERIAL_BATCH_STREAM_HOLD:number;
export function openWorkspaceMaterialBatch(response:Response,expected:readonly MaterialBatchRecord[],revision:string):Promise<{token:string;next(wanted:MaterialBatchRecord):Promise<Uint8Array>;cancel():Promise<void>}>;
