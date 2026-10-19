// SPDX-License-Identifier: AGPL-3.0-or-later
// Build-only export from the pinned Node binary, with no network/custom roots.
import {rootCertificates} from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function writeMaintenanceCA(directory){
 if(process.version!=='v24.21.0'||rootCertificates.length<1||rootCertificates.length>1000)throw Error('MAINTENANCE_CA_SOURCE');
 for(const certificate of rootCertificates)if(!new X509Certificate(certificate).ca)throw Error('MAINTENANCE_CA_CERTIFICATE');
 const pem=rootCertificates.join('\n')+'\n',metadata={nodeVersion:process.version,certificateCount:rootCertificates.length,pemSha256:createHash('sha256').update(pem).digest('hex'),source:'https://github.com/nodejs/node/blob/v24.21.0/src/node_root_certs.h',notice:'mozilla-ca-NOTICE.txt',license:'mozilla-ca-MPL-2.0.txt'};
 await mkdir(directory,{recursive:true,mode:0o755});
 await writeFile(join(directory,'ca-certificates.crt'),pem,{flag:'wx',mode:0o644});
 await writeFile(join(directory,'maintenance-ca.json'),JSON.stringify(metadata)+'\n',{flag:'wx',mode:0o644});return metadata;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await writeMaintenanceCA(process.argv[2]??'/opt/exhibitos/licenses')));
