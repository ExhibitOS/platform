// SPDX-License-Identifier: AGPL-3.0-or-later
import {open} from 'node:fs/promises';
import {createServer} from 'node:http';
import {verifyFreezeBundle, MAX_FREEZE_BYTES} from '../packages/studio-contract/dist/index.js';

// The build embeds the public verifier into offline-server.mjs. No npm install,
// private repository, extraction, remote fetch, or signing key is needed there.
const args=process.argv.slice(2), archive=args.shift();
let trustKey, port=0;
for(let i=0;i<args.length;i++){
 if(args[i]==='--trust-key')trustKey=args[++i];
 else if(args[i]==='--port')port=Number(args[++i]);
 else throw Error('UNKNOWN_ARGUMENT');
}
if(!archive||!trustKey||!/^[a-f0-9]{64}$/.test(trustKey)||!Number.isInteger(port)||port<0||port>65535)throw Error('Usage: node offline-server.mjs file.oef --trust-key <trusted SHA256 key fingerprint> [--port 0]');
const handle=await open(archive,'r');let raw;
try{const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>MAX_FREEZE_BYTES)throw Error('FREEZE_LIMIT');raw=await handle.readFile();if(raw.length>MAX_FREEZE_BYTES)throw Error('FREEZE_LIMIT');}finally{await handle.close();}
const {bundle,runtimeFiles}=await verifyFreezeBundle(raw,{trustedKeys:[trustKey]});
const grant=bundle.authorization.grant;
let highWater=Date.now();
function validTime(){const now=Date.now();if(now<highWater||now<Date.parse(grant.issuedAt)||now>=Date.parse(grant.expiresAt))return false;highWater=now;return true;}
const server=createServer((request,response)=>{
 const address=server.address();const authority=`127.0.0.1:${typeof address==='object'&&address?address.port:port}`;
 const headers={'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
 if(request.headers.host!==authority||request.headers.origin&&request.headers.origin!==`http://${authority}`||request.method!=='GET'||!validTime()){response.writeHead(403,{'cache-control':'no-store',...headers});response.end('OFFLINE_ACCESS_DENIED');return;}
 let url;try{url=new URL(request.url,`http://${authority}`);}catch{response.writeHead(400,headers);response.end();return;}
 if(url.search||url.hash){response.writeHead(404,headers);response.end();return;}
 let bytes,mime,cache='public, max-age=0, must-revalidate';
 if(url.pathname==='/offline-package'){bytes=raw;mime='application/json';cache='no-store';}
 else if(url.pathname==='/offline-authority'){bytes=Buffer.from(JSON.stringify({authority:bundle.manifest.authority,tenantId:grant.tenantId,subjectId:grant.subjectId,expiresAt:grant.expiresAt,portableMode:true}));mime='application/json';cache='no-store';}
 else {const path=['/offline','/studio','/'].includes(url.pathname)?'index.html':url.pathname.slice(1);bytes=runtimeFiles.get(path);mime=bundle.manifest.runtime.files.find(file=>file.path===path)?.mime;}
 if(!bytes||!mime){response.writeHead(404,{'cache-control':'no-store',...headers});response.end();return;}
 response.writeHead(200,{'content-type':mime,'content-length':bytes.length,'cache-control':cache,...headers});response.end(bytes);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
console.info(`ExhibitOS offline http://127.0.0.1:${server.address().port}/offline`);
console.info(`Display grant expires ${grant.expiresAt}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
