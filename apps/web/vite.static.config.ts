import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
// Native publication packaging selects its existing Viewer entry explicitly.
// Without the producer option, the public Viewer + Studio demo stays unchanged.
const target = process.env.EXHIBITOS_STATIC_TARGET;
if (target !== undefined && target !== "viewer") throw Error("PUBLICATION_STATIC_TARGET_INVALID");
const stagingDiagnostics=process.env.EXHIBITOS_STAGING_DIAGNOSTICS==='1';
const packageVersion:unknown=JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)),"utf8")).version;
if(typeof packageVersion!=="string"||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(packageVersion))throw Error("VIEWER_PACKAGE_VERSION_INVALID");
let sourceCommit:string|null=null;
let sourceTree:string|null=null;
try {
  const options={cwd:fileURLToPath(new URL("../..",import.meta.url)),encoding:"utf8" as const,stdio:["ignore","pipe","ignore"] as ["ignore","pipe","ignore"]};
  const commit=execFileSync("git",["rev-parse","HEAD"],options).trim();
  const changes=execFileSync("git",["status","--porcelain","--untracked-files=normal"],options).trim();
  const tree=execFileSync("git",["rev-parse","HEAD^{tree}"],options).trim();
  if(process.versions.node==="24.21.0"&&process.env.npm_config_user_agent?.startsWith("npm/11.19.0 ")&&process.argv.includes("build")&&/^[a-f0-9]{40}$/.test(commit)&&/^[a-f0-9]{40}$/.test(tree)&&!changes){sourceCommit=commit;sourceTree=tree;}
} catch { /* A source-less or modified build has no verified commit identity. */ }
const lockSha256=createHash("sha256").update(readFileSync(fileURLToPath(new URL("../../package-lock.json", import.meta.url)))).digest("hex");
const buildId=sourceCommit&&sourceTree?createHash("sha256").update(JSON.stringify({sourceCommit,sourceTree,lockSha256,packageVersion,target:target??"default",privateEditor:process.env.EXHIBITOS_PRIVATE_EDITOR==="1",...(stagingDiagnostics?{stagingDiagnostics:true}:{})})).digest("hex"):null;
export default defineConfig({define:{__EXHIBITOS_STAGING_DIAGNOSTICS__:JSON.stringify(stagingDiagnostics),__EXHIBITOS_VIEWER_BUILD_ID__:JSON.stringify(buildId),__EXHIBITOS_VIEWER_PACKAGE_VERSION__:JSON.stringify(packageVersion),__EXHIBITOS_VIEWER_SOURCE_COMMIT__:JSON.stringify(sourceCommit)},plugins:[react(),{name:"viewer-build-identity",transformIndexHtml:{order:"pre",handler:()=>[{tag:"meta",attrs:{name:"exhibitos-viewer-build-id",content:buildId??""},injectTo:"head"}]}}],build:{outDir:"dist-static",rollupOptions:{input:target === "viewer" && process.env.EXHIBITOS_PRIVATE_EDITOR !== "1" ? ["static.html"] : ["static.html","static-studio.html"]}}});
