declare module 'gltf-validator' {
 export function validateBytes(bytes:Uint8Array,options:Record<string,unknown>):Promise<{
  issues:{numErrors:number;numWarnings:number};
  info?:{resources?:Array<{pointer?:string;storage?:string;mimeType?:string;image?:{width:number;height:number;bits:number}}>};
 }>;
}
