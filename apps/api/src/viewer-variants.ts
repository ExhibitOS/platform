// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from "node:child_process";
export interface VariantMetric {triangles?:number;textureSize?:number}
export interface GeneratedVariants {full:VariantMetric;coarse?:VariantMetric;bytes?:Buffer}
export function viewerVariants(bytes:Buffer,mime:string,options:{timeoutMs?:number}={}):Promise<GeneratedVariants>{return new Promise((resolve,reject)=>{const url=new URL("./viewer-variant-worker.js",import.meta.url);if(import.meta.url.endsWith('.ts'))url.pathname=url.pathname.replace(/\.js$/,'.ts');const child=execFile(process.execPath,["--max-old-space-size=128",url.pathname,mime],{timeout:Math.min(8000,Math.max(1,options.timeoutMs??8000)),maxBuffer:33555456,encoding:"buffer",env:{PATH:process.env.PATH},killSignal:"SIGKILL"},(error,out)=>{if(error||out.length<8||out.toString("ascii",0,4)!=="ELOD"){reject(Error("COARSE_UNAVAILABLE"));return;}try{const length=out.readUInt32LE(4);if(length>1024||8+length>out.length)throw Error("VARIANT_METADATA");const info=JSON.parse(out.toString("utf8",8,8+length)) as GeneratedVariants;resolve({...info,...(info.coarse?{bytes:out.subarray(8+length)}:{})});}catch{reject(Error("COARSE_UNAVAILABLE"));}});child.stdin?.on("error",()=>{});child.stdin?.end(bytes);});}

/** Qualified full display bytes have already passed the isolated format/profile decoder.
 * Measure independently so simplifier refusal/timeout cannot erase GPU budget evidence. */
export function measureFullVariant(bytes:Buffer,mime:string):VariantMetric {
 if(mime==="image/png") {if(bytes.length<33)throw Error("FULL_VARIANT_INVALID");const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||Math.max(width,height)>8192)throw Error("FULL_VARIANT_INVALID");return {textureSize:Math.max(width,height)};}
 if(mime!=="model/gltf-binary"||bytes.length<28||bytes.toString("ascii",0,4)!=="glTF")throw Error("FULL_VARIANT_INVALID");
 const size=bytes.readUInt32LE(12);if(size>1048576||20+size>bytes.length)throw Error("FULL_VARIANT_INVALID");const doc=JSON.parse(bytes.toString("utf8",20,20+size));let triangles=0;
 for(const node of doc.nodes??[]){if(node.mesh===undefined)continue;for(const primitive of doc.meshes?.[node.mesh]?.primitives??[]){if((primitive.mode??4)!==4)throw Error("FULL_VARIANT_UNSUPPORTED");const accessor=doc.accessors?.[primitive.indices??primitive.attributes?.POSITION];if(!accessor||!Number.isSafeInteger(accessor.count)||accessor.count<3||accessor.count%3)throw Error("FULL_VARIANT_INVALID");triangles+=accessor.count/3;}}
 if(!Number.isSafeInteger(triangles)||triangles<1||triangles>1000000)throw Error("FULL_VARIANT_INVALID");return {triangles};
}
