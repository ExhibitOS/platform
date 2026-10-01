import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function verifyArtifact() {
  const artifact = JSON.parse(await readFile(new URL('../contracts/artifact.json', import.meta.url), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || !/^[a-f0-9]{40}$/.test(artifact.upstreamSourceCommit)) {
    throw new Error('Missing immutable public contract provenance');
  }
  if (!/^vendor\/exhibitos-spec-[a-zA-Z0-9.-]+\.tgz$/.test(artifact.file)) {
    throw new Error('Invalid public contract archive path');
  }
  const bytes = await readFile(new URL(`../${artifact.file}`, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
    throw new Error('Public contract archive SHA-256 mismatch');
  }
  return artifact;
}
