import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { ApiError } from "./auth.ts";
import {normalizeDisplayWatermark,embeddedWatermarkTextSupported,type DisplayWatermark} from '@exhibitos/studio-contract';
export interface DerivativeOptions {maxTextureSize?:512|2048;watermark?:DisplayWatermark;signal?:AbortSignal}
export async function derivative(bytes: Buffer, mime: string, options?: DerivativeOptions) {
  const signal = options?.signal;
  if (signal?.aborted) throw new ApiError(422, "DERIVATIVE_CANCELLED");
  let watermark:DisplayWatermark;
  try{watermark=normalizeDisplayWatermark(options?.watermark);}catch{throw new ApiError(422,'DISPLAY_WATERMARK_INVALID');}
  // Overlay never alters a file. Embedded GLB is explicitly unsupported;
  // mixed-media publications use a clean model, independently of PNG labels.
  if(watermark.mode==='overlay'||mime==='model/gltf-binary')watermark={version:1,mode:'none'};
  if(watermark.mode==='embedded'&&!embeddedWatermarkTextSupported(watermark.text??'EXHIBITOS'))throw new ApiError(422,'WATERMARK_TEXT_UNSUPPORTED');
  return new Promise<Buffer>((resolve, reject) => {
    const url = new URL("./validation-worker.js", import.meta.url);
    if (import.meta.url.endsWith(".ts"))
      url.pathname = url.pathname.replace(/\.js$/, ".ts");
    let result: {error: Error | null; out: Buffer} | undefined;
    let cancelled = false;
    const child = execFile(
      process.execPath,
      ["--max-old-space-size=128", fileURLToPath(url), mime, "derivative",String(options?.maxTextureSize??512),JSON.stringify(watermark)],
      {
        timeout: 5000,
        maxBuffer: 40 * 1024 * 1024,
        encoding: "buffer",
        env: { PATH: process.env.PATH },
        killSignal: "SIGKILL",
      },
      (error, out) => { result = {error, out}; },
    );
    const abort = () => { cancelled = true; child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, {once: true});
    child.once("close", () => {
      signal?.removeEventListener("abort", abort);
      if (cancelled || signal?.aborted) reject(new ApiError(422, "DERIVATIVE_CANCELLED"));
      else if (!result || result.error || result.out.length > 32 * 1024 * 1024) reject(new ApiError(422, "DERIVATIVE_FAILED"));
      else resolve(result.out);
    });
    if (signal?.aborted) abort();
    child.stdin?.on("error", () => {});
    child.stdin?.end(bytes);
  });
}
