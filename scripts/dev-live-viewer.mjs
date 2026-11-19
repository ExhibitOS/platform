// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
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

const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
const template = await readFile(join(root, 'static.html'), 'utf8');
const shell = shellBytes.toString('utf8');
const cover = shell.match(/<body><div id="root">([\s\S]*)<\/div><\/body>/)?.[1];
const title = shell.match(/<title>[^<]*<\/title>/)?.[0];
if (cover === undefined || !title || template.split('STATIC_INDEX_SHA256').length !== 2 ||
    template.split('<!--STATIC_COVER_SHELL-->').length !== 2) throw Error('LIVE_VIEWER_SHELL');
const html = template.replace('STATIC_INDEX_SHA256', indexSha256)
  .replace('<!--STATIC_COVER_SHELL-->', () => cover)
  .replace(/<title>[^<]*<\/title>/, () => title);

const server = await createServer({
  root,
  mode:'live-viewer-pose',
  configFile:join(root, 'vite.static.config.ts'),
  publicDir:sourceDir,
  server:{host:'127.0.0.1',port,strictPort:true,allowedHosts:[]},
  plugins:[{
    name:'local-exact-live-viewer',
    configureServer(vite){
      vite.middlewares.use((request,response,next)=>{
        if (request.method !== 'GET') return next();
        const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        if (path !== '/' && path !== '/index.html') return next();
        void vite.transformIndexHtml('/index.html',html).then(result=>{
          response.setHeader('Content-Type','text/html; charset=utf-8');
          response.setHeader('Cache-Control','no-store');
          response.end(result);
        },next);
      });
    },
  }],
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT','SIGTERM']) {
  process.once(signal,()=>{void server.close().then(()=>{process.exitCode=0;});});
}
