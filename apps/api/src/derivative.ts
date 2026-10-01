import { execFile } from "node:child_process";
import { ApiError } from "./auth.ts";
export function derivative(bytes: Buffer, mime: string, options?: {maxTextureSize:512|2048}) {
  return new Promise<Buffer>((resolve, reject) => {
    const url = new URL("./validation-worker.js", import.meta.url);
    if (import.meta.url.endsWith(".ts"))
      url.pathname = url.pathname.replace(/\.js$/, ".ts");
    const child = execFile(
      process.execPath,
      ["--max-old-space-size=128", url.pathname, mime, "derivative",String(options?.maxTextureSize??512)],
      {
        timeout: 5000,
        maxBuffer: 40 * 1024 * 1024,
        encoding: "buffer",
        env: { PATH: process.env.PATH },
        killSignal: "SIGKILL",
      },
      (error, out) =>
        error || out.length > 32 * 1024 * 1024
          ? reject(new ApiError(422, "DERIVATIVE_FAILED"))
          : resolve(out),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(bytes);
  });
}
