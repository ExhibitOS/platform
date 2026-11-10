// SPDX-License-Identifier: AGPL-3.0-or-later
import {fstatSync,lstatSync,realpathSync} from 'node:fs';
import {basename,isAbsolute} from 'node:path';
import {closeNativeOwnerDescriptor} from './native-owner-channel.mjs';
import {openAdoptionOwnerHandshake} from './native-hayes-owner-channel.mjs';

export const ADOPTION_OWNER_FD='EXHIBITOS_NATIVE_MODEL_ADOPTION_FD';
export const ADOPTION_ROOT_FD='EXHIBITOS_NATIVE_MODEL_ADOPTION_ROOT_FD';
export const ADOPTION_MARKER='native-model-adoption-capability-v1.json';
export const ADOPTION_CAPABILITY='{"version":1,"profile":"native-model-adoption-v1"}\n';
const marker='platform/scripts/'+ADOPTION_MARKER;
const markerDigest='1cc2e6bc81fec1ef0aa6b6643dd177feff9480ad690d7b1b75e870b5072ca4a3';

const descriptor=value=>typeof value==='string'&&/^[1-9][0-9]{1,3}$/.test(value)&&Number(value)<=1023;
const unavailable=()=>Error('NATIVE_MODEL_ADOPTION_UNAVAILABLE');

function otherDescriptors(environment){
 const list=value=>typeof value==='string'?value.split(','):[];
 return [
  environment.EXHIBITOS_NATIVE_OWNER_FD,environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD,
  environment.EXHIBITOS_NATIVE_FURNISHING_WRITER_FD,environment.EXHIBITOS_TEST_HAYES_SOURCE_FD,
  environment.EXHIBITOS_NATIVE_OEX_CONTROL_FD,environment.EXHIBITOS_OEX_FORMAT_FD,
  environment.EXHIBITOS_OEX_MATERIALIZER_FD,
  ...list(environment.EXHIBITOS_OEX_PREFLIGHT_FDS),
  ...list(environment.EXHIBITOS_OEX_PACKED_V2_FDS),
 ].map(Number);
}

export function closeUnusedAdoptionDescriptors(environment,{socketTaken=false,rootClosed=false}={}){
 const occupied=otherDescriptors(environment);
 if(socketTaken)occupied.push(Number(environment[ADOPTION_OWNER_FD]));
 if(rootClosed)occupied.push(Number(environment[ADOPTION_ROOT_FD]));
 for(const fd of new Set([environment[ADOPTION_OWNER_FD],environment[ADOPTION_ROOT_FD]])){
  if(!occupied.includes(Number(fd)))closeNativeOwnerDescriptor(fd);
 }
}

export function assertAdoptionPayload(payload,pin,isCatalog045,{upgrade=false}={}){
 if(!pin&&!payload.hasPath(marker))return;
 if(!isCatalog045||(!pin&&!upgrade)||(pin&&(upgrade||payload.digest!==pin.runtimeManifestSha256))||
    !payload.hasRegular(marker)||!payload.hasExact(marker,markerDigest,Buffer.byteLength(ADOPTION_CAPABILITY)))throw unavailable();
}

// Validate the inherited pair before opening any channel. The caller owns both
// descriptors until it starts the handshake, which takes only the socket.
export function inspectAdoptionDescriptors(environment,pin){
 const fd=environment[ADOPTION_OWNER_FD],root=environment[ADOPTION_ROOT_FD];
 if(pin===undefined&&fd===undefined&&root===undefined)return undefined;
 const occupied=otherDescriptors(environment);
 if(!pin||!descriptor(fd)||!descriptor(root)||fd===root||occupied.includes(Number(fd))||occupied.includes(Number(root)))throw unavailable();
 try{
  const uid=BigInt(process.geteuid()),stat=fstatSync(Number(root),{bigint:true});
  if(!fstatSync(Number(fd)).isSocket()||!stat.isDirectory()||stat.uid!==uid||(stat.mode&0o7777n)!==0o700n||
     String(stat.dev)!==pin.rootDevice||String(stat.ino)!==pin.rootInode)throw unavailable();
  if(typeof pin.helper!=='string'||!isAbsolute(pin.helper)||basename(pin.helper)!=='exhibitos-native'||realpathSync(pin.helper)!==pin.helper)throw unavailable();
  const helper=lstatSync(pin.helper,{bigint:true});
  if(!helper.isFile()||helper.nlink!==1n||(helper.uid!==uid&&helper.uid!==0n)||(helper.mode&0o022n)!==0n||(helper.mode&0o111n)===0n)throw unavailable();
 }catch{throw unavailable();}
 return {fd,broker:{helper:pin.helper,rootFd:Number(root),rootDevice:pin.rootDevice,rootInode:pin.rootInode}};
}

export function openAdoptionOwnerChannel(descriptors,workspace,pin,signal){
 return openAdoptionOwnerHandshake(descriptors.fd,workspace,pin,signal);
}
