// SPDX-License-Identifier: AGPL-3.0-or-later
// Native-only owner channel. The general public-projection exporter stays reusable.
import {fstatSync} from 'node:fs';
import {exportStaticPublication} from './export-static-publication.mjs';

let finished = false;
const parentGone = () => { if (!finished) process.exit(72); };
try {
  const descriptor = fstatSync(0);
  if (!(descriptor.isFIFO() || (descriptor.isSocket() && process.stdin.remoteAddress === undefined && process.stdin.localAddress === undefined))) throw Error('STATIC_OWNER_PIPE_REQUIRED');
  process.stdin.once('end', parentGone);
  process.stdin.once('error', parentGone);
  // No credential or command is read from this pipe. Its owning helper keeps
  // the write end open; even SIGKILL closes it and ends this bounded child.
  process.stdin.resume();
  const [origin, publicationId, runtimeRoot, output, ...extra] = process.argv.slice(2);
  if (!origin || !publicationId || !runtimeRoot || !output || extra.length) throw Error('STATIC_NATIVE_USAGE');
  const receipt = await exportStaticPublication({origin,publicationId,runtimeRoot,output});
  finished = true;
  console.log(JSON.stringify(receipt));
} catch (error) {
  finished = true;
  console.error(/^STATIC_[A-Z_]+(?::|$)/.test(error.message) ? error.message.split(':')[0] : 'STATIC_NATIVE_FAILED');
  process.exitCode = 1;
} finally {
  process.stdin.destroy();
}
