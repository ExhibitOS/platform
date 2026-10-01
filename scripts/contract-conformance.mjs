import { verifyArtifact } from './artifact-integrity.mjs';

try {
  const artifact = await verifyArtifact();
  const { runConformance } = await import('@exhibitos/spec');
  const result = await runConformance();
  console.log(JSON.stringify({ package: artifact.package, version: artifact.packageVersion, artifactSha256: artifact.sha256, ...result }));
  process.exitCode = result.valid ? 0 : 1;
} catch {
  console.log(JSON.stringify({ valid: false, cases: [], errors: [{ code: 'CONSUMER_CONFORMANCE_FAILED', message: 'Verify the pinned public artifact, installation, and fixtures.' }] }));
  process.exitCode = 1;
}
