// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, readFile, realpath, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {extname, isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {localStaticPublicationSource} from './local-static-publication-source.mjs';

const [directory, manifestSha256, portText = '58139', ...extra] = process.argv.slice(2);
const port = Number(portText);
if (!directory || !isAbsolute(directory) || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? '') ||
    !Number.isInteger(port) || port < 1024 || port > 65535 || extra.length) {
  throw Error('Usage: node scripts/dev-live-viewer.mjs /absolute/static-export MANIFEST_SHA256 [port]');
}
const sourceDir = await realpath(directory);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(join(sourceDir, 'static-export-manifest.json'));
if (hash(manifestBytes) !== manifestSha256) throw Error('LIVE_VIEWER_MANIFEST_PIN');
const {indexSha256, publicationId, revisionSha256} = JSON.parse(manifestBytes);
const source = await localStaticPublicationSource({sourceDir, sourceManifestSha256:manifestSha256, indexSha256, publicationId, revisionSha256});
const shellBytes = await source.read('index.html');
const shell = shellBytes.toString('utf8');
const cover = shell.match(/<body><div id="root">([\s\S]*)<\/div><\/body>/)?.[1];
const title = shell.match(/<title>[^<]*<\/title>/)?.[0];
if (cover === undefined || !title) throw Error('LIVE_VIEWER_SHELL');

const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
const staging = await mkdtemp(join(tmpdir(), 'exhibitos-live-viewer-'));
let server;
try {
  process.env.EXHIBITOS_STATIC_TARGET='viewer';
  delete process.env.EXHIBITOS_PRIVATE_EDITOR;
  delete process.env.EXHIBITOS_STAGING_DIAGNOSTICS;
  await build({
    root, mode:'live-viewer-pose', configFile:join(root, 'vite.static.config.ts'), publicDir:false,
    define:{'import.meta.env.EXHIBITOS_LOOPBACK_LIVE_POSE':JSON.stringify('1')},
    build:{outDir:staging,copyPublicDir:false,emptyOutDir:true},
  });
  const template = await readFile(join(staging, 'static.html'), 'utf8');
  if (template.split('STATIC_INDEX_SHA256').length !== 2 ||
      template.split('<!--STATIC_COVER_SHELL-->').length !== 2) throw Error('LIVE_VIEWER_BUILT_SHELL');
  const html = Buffer.from(template.replace('STATIC_INDEX_SHA256', indexSha256)
    .replace('<!--STATIC_COVER_SHELL-->', () => cover)
    .replace(/<title>[^<]*<\/title>/, () => title));

  const files = new Map();
  const staticViewerFiles=new Set(['static-publication-index.json','viewer-favicon.svg','voice-pcm-worklet.js',
    'THIRD_PARTY_NOTICES.txt','floor-texture-notices.txt','basis/basis_transcoder.js',
    'basis/basis_transcoder.wasm','basis/exhibitos-basis-worker.js']);
  for (const [path, entry] of source.entries) {
    if (staticViewerFiles.has(path) || /^data\/[a-f0-9]{64}\.(?:json|bin)$/.test(path) ||
        /^(?:floor-textures|surface-material-textures)\/.*\.png$/.test(path) ||
        /^surface-material-notices\/[A-Za-z0-9_.-]+\.txt$/.test(path)) {
      files.set(path,{length:entry.bytes,read:()=>source.read(path)});
    }
  }
  files.set('static-export-manifest.json',{length:manifestBytes.length,read:()=>manifestBytes});
  for (const entry of await readdir(join(staging,'assets'),{withFileTypes:true})) {
    if (!entry.isFile()) throw Error('LIVE_VIEWER_BUNDLE_ENTRY');
    const bytes=await readFile(join(staging,'assets',entry.name));
    files.set('assets/'+entry.name,{length:bytes.length,read:()=>bytes});
  }
  const mime = {'.json':'application/json','.js':'text/javascript','.css':'text/css',
    '.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
    '.webp':'image/webp','.avif':'image/avif','.txt':'text/plain; charset=utf-8'};
  server = createServer((request,response)=>{
    if (request.headers.host !== '127.0.0.1:'+port || !['GET','HEAD'].includes(request.method)) {
      response.writeHead(403).end();
      return;
    }
    const path = request.url?.split('?')[0] ?? '/';
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    if (path==='/' || path==='/index.html') {
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':html.length});
      response.end(request.method==='GET'?html:undefined);
      return;
    }
    const entry = files.get(path.slice(1));
    if (!entry) {
      response.writeHead(404).end();
      return;
    }
    void Promise.resolve().then(async ()=>{
      const bytes=request.method==='GET'?await entry.read():undefined;
      response.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Content-Length':entry.length});
      response.end(bytes);
    }).catch(()=>{response.writeHead(410).end();});
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',resolve);
  });
} catch (error) {
  await rm(staging,{recursive:true,force:true});
  throw error;
}
console.log('Local Viewer at http://127.0.0.1:'+port+'/');
let closing=false;
function close() {
  if (closing) return;
  closing=true;
  server.close(()=>{void rm(staging,{recursive:true,force:true});});
  server.closeAllConnections();
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,close);
