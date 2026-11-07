// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=/^[a-f0-9]{64}$/;
const safe=p=>typeof p==='string'&&p.length<=240&&/^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p)&&p.split('/').every(x=>x!=='.'&&x!=='..'&&!x.endsWith('.'));
const fail=()=>{throw Error('REFRESH_SOURCE_INVALID');};

// Each component is checked; the opened file itself may not be a symlink.
async function readRegular(root,path,limit,cancelled=()=>false){
 if(cancelled())throw Error('REFRESH_CANCELLED');
 if(!safe(path))fail();
 const parts=path.split('/');let dir=root;
 for(const part of parts.slice(0,-1)){dir=join(dir,part);const st=await lstat(dir);if(!st.isDirectory()||st.isSymbolicLink())fail();}
 const handle=await open(join(root,path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)fail();const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){if(cancelled())throw Error('REFRESH_CANCELLED');const {bytesRead}=await handle.read(bytes,offset,Math.min(bytes.length-offset,1024*1024),offset);if(!bytesRead)fail();offset+=bytesRead;}const after=await handle.stat();if(after.size!==stat.size)fail();return bytes;}finally{await handle.close();}
}

/** Verify the complete source export and expose only pinned public index/data. */
export async function localStaticPublicationSource({sourceDir,sourceManifestSha256,indexSha256,publicationId,revisionSha256},{cancelled=()=>false}={}){
 const root=resolve(sourceDir),st=await lstat(root);if(!st.isDirectory()||st.isSymbolicLink()||!sha.test(sourceManifestSha256)||!sha.test(indexSha256)||!sha.test(revisionSha256))fail();
 const manifestBytes=await readRegular(root,'static-export-manifest.json',2*1024*1024,cancelled);if(digest(manifestBytes)!==sourceManifestSha256)fail();
 let manifest;try{manifest=JSON.parse(manifestBytes);}catch{fail();}
 if(manifest.format!=='exhibitos-static-publication-v1'||manifest.publicationId!==publicationId||manifest.revisionSha256!==revisionSha256||manifest.indexSha256!==indexSha256||!Array.isArray(manifest.files)||manifest.files.length>20000)fail();
 let total=0;const entries=new Map();for(const entry of manifest.files){if(!safe(entry.path)||entry.path==='static-export-manifest.json'||entries.has(entry.path)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>25*1024*1024||!sha.test(entry.sha256))fail();total+=entry.bytes;if(total>512*1024*1024)fail();entries.set(entry.path,entry);}
 if(entries.get('static-publication-index.json')?.sha256!==indexSha256)fail();
 const pending=new Set(entries.keys());
 const directories=new Set([...entries.keys()].flatMap(path=>{const parts=path.split('/');return parts.slice(0,-1).map((_,i)=>parts.slice(0,i+1).join('/'));}));
 let visited=0;async function walk(dir,prefix='',depth=0){if(cancelled())throw Error('REFRESH_CANCELLED');if(depth>32)fail();for(const item of await readdir(dir,{withFileTypes:true})){if(++visited>40000)fail();const path=prefix+item.name;if(item.isDirectory()){if(!directories.has(path))fail();await walk(join(dir,item.name),path+'/',depth+1);}else if(item.isFile()&&path==='static-export-manifest.json'){}else if(item.isFile()&&pending.delete(path)){}else fail();}}
 await walk(root);if(pending.size)fail();
 for(const [path,entry] of entries){const bytes=await readRegular(root,path,entry.bytes,cancelled);if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)fail();}
 const origin='https://local-static-publication.invalid';
 const fetch=async input=>{const url=new URL(input);if(url.origin!==origin||url.search||url.hash||!/^\/(?:static-publication-index\.json|data\/[a-f0-9]{64}\.(?:json|bin))$/.test(url.pathname))fail();const path=url.pathname.slice(1),entry=entries.get(path);if(!entry)fail();const bytes=await readRegular(root,path,entry.bytes,cancelled);if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)fail();return new Response(bytes);};
 return {origin,fetch,entries};
}

/** Reject unclassified content and any logical publication byte drift. */
export function assertSamePublicationContent(entries,generated){
 const content=p=>p==='static-publication-index.json'||p.startsWith('data/')||p.startsWith('floor-textures/')||p==='floor-texture-notices.txt'||p.startsWith('surface-material-textures/')||p.startsWith('surface-material-notices/');
 const shell=p=>/^assets\/[A-Za-z0-9_.-]+$/.test(p)||/^basis\/[A-Za-z0-9_.-]+$/.test(p)||['index.html','studio.html','THIRD_PARTY_NOTICES.txt','viewer-favicon.svg','voice-pcm-worklet.js'].includes(p);
 if(!Array.isArray(generated)||[...entries.keys(),...generated.map(x=>x.path)].some(path=>!content(path)&&!shell(path)))throw Error('REFRESH_CONTENT_UNCLASSIFIED');
 const actual=new Map(generated.filter(x=>content(x.path)).map(x=>[x.path,x]));
 const expected=[...entries].filter(([path])=>content(path));
 if(actual.size!==expected.length||generated.filter(x=>content(x.path)).length!==actual.size||expected.some(([path,old])=>{const item=actual.get(path);return !item||item.bytes!==old.bytes||item.sha256!==old.sha256;}))throw Error('REFRESH_CONTENT_CHANGED');
}
