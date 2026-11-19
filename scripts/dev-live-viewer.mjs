// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp, readdir, readFile, realpath, rm, stat} from 'node:fs/promises';
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
const shellBytes = await readFile(join(sourceDir, 'index.html'));
if (hash(shellBytes) !== source.entries.get('index.html')?.sha256) throw Error('LIVE_VIEWER_SHELL_PIN');
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
  for (const [path, entry] of source.entries) {
    if (!path.endsWith('.html')) files.set(path,{path:join(sourceDir,path),size:entry.bytes});
  }
  files.set('static-export-manifest.json',{path:join(sourceDir,'static-export-manifest.json'),size:manifestBytes.length});
  for (const entry of await readdir(join(staging,'assets'),{withFileTypes:true})) {
    if (!entry.isFile()) throw Error('LIVE_VIEWER_BUNDLE_ENTRY');
    const path = join(staging,'assets',entry.name);
    files.set('assets/'+entry.name,{path,size:(await stat(path)).size});
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
    response.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Content-Length':entry.size});
    if (request.method==='HEAD') response.end();
    else createReadStream(entry.path).on('error',()=>response.destroy()).pipe(response);
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
