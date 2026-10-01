import { readFile, mkdir, writeFile } from 'node:fs/promises';

// Keep this list aligned with third-party implementations bundled into the web.
const packages = ['react', 'react-dom', 'scheduler', 'three'];
const notices = ['Third-party implementations included in the ExhibitOS web bundle.\nTheir original licenses apply independently of the project AGPL license.\n'];
for (const name of packages) {
  const root = `node_modules/${name}`;
  const metadata = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
  const license = await readFile(`${root}/LICENSE`, 'utf8');
  notices.push(`\n--- ${name} ${metadata.version} (${metadata.license}) ---\n\n${license}`);
}
await mkdir('apps/web/public', { recursive: true });
await writeFile('apps/web/public/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
console.log(`Preserved original notices for ${packages.length} bundled runtime packages.`);
