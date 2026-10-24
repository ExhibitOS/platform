// SPDX-License-Identifier: AGPL-3.0-or-later
import { fstatSync } from 'node:fs';
/** One bounded inherited stdin pipe or local socketpair from the owning Manager. Never a network listener,
 * file credential, environment token, URL or publicly callable bootstrap. */
export async function readNativeWorkspaceChannel() {
  const descriptor = fstatSync(0);
  const inherited = descriptor.isFIFO() || (descriptor.isSocket() && process.stdin.remoteAddress === undefined && process.stdin.localAddress === undefined);
  if (process.platform !== 'darwin' || !process.getuid || process.getuid() <= 0 || !inherited) throw Error('LOCAL_WORKSPACE_CHANNEL_REQUIRED');
  const chunks = []; let count = 0;
  return await new Promise((resolve, reject) => {
    const fail = () => { cleanup(); process.stdin.destroy(); for (const chunk of chunks) chunk.fill(0); reject(Error('LOCAL_WORKSPACE_CHANNEL_INVALID')); };
    const timer = setTimeout(fail, 5000);
    const cleanup = () => { clearTimeout(timer); process.stdin.off('data', data); process.stdin.off('end', end); process.stdin.off('error', fail); };
    const data = chunk => { count += chunk.length; if (count > 4096) { chunk.fill(0); fail(); } else { chunks.push(chunk); } };
    const end = () => {
      cleanup(); const bytes = Buffer.concat(chunks);
      try { resolve(JSON.parse(bytes.toString('utf8'))); } catch { reject(Error('LOCAL_WORKSPACE_CHANNEL_INVALID')); }
      finally { bytes.fill(0); for (const chunk of chunks) chunk.fill(0); }
    };
    process.stdin.on('data', data); process.stdin.once('end', end); process.stdin.once('error', fail);
  });
}
