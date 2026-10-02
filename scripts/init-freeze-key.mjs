// SPDX-License-Identifier: AGPL-3.0-or-later
import {generateKeyPairSync,createHash} from 'node:crypto';
import {open,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const path=resolve(process.argv[2]??'.local/freeze-key.json');
await mkdir(dirname(path),{recursive:true,mode:0o700});
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const file=await open(path,'wx',0o600);
try{await file.writeFile(JSON.stringify({name:'exhibitos-freeze-ed25519',schemaVersion:'1.0.0-draft.1',privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64')})+'\n');await file.sync();}finally{await file.close();}
console.info(`Freeze signing key created: ${path}`);
console.info(`Public trust fingerprint: ${createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex')}`);
