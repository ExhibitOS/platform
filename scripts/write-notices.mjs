import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
const resolveWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);

// Keep this list aligned with third-party implementations bundled into the web.
const packages = [
  "react",
  "react-dom",
  "scheduler",
  "three",
  "@dimforge/rapier3d-compat",
  "ajv",
  "ajv-formats",
  "fast-deep-equal",
  "fast-uri",
  "json-schema-traverse",
  "require-from-string",
];
const notices = [
  "Third-party implementations included in the ExhibitOS web bundle.\nTheir original licenses apply independently of the project AGPL license.\n",
];
for (const name of packages) {
  // Resolve the actual browser workspace entry even when package exports hide package.json.
  // Walking its ancestors avoids silently attributing a different hoisted version.
  let root = dirname(resolveWeb.resolve(name));
  for (let depth = 0; ; depth++) {
    if (depth > 12) throw Error(`Cannot locate bundled package metadata: ${name}`);
    let candidate;
    try { candidate = JSON.parse(await readFile(`${root}/package.json`, "utf8")); } catch { /* Entry may be within a dist directory. */ }
    if (candidate?.name === name) break;
    const parent = dirname(root);
    if (parent === root) throw Error(`Cannot locate bundled package metadata: ${name}`);
    root = parent;
  }
  const metadata = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
  // npm packages may ship lowercase `license`; Linux filesystems are case-sensitive.
  const licenseFiles = (await readdir(root)).filter(file => /^license(?:\.md|\.txt)?$/i.test(file)).sort();
  if (!licenseFiles.length) throw Error(`Missing original bundled package license: ${name}`);
  const license = await readFile(`${root}/${licenseFiles[0]}`, "utf8");
  notices.push(
    `\n--- ${name} ${metadata.version} (${metadata.license}) ---\n\n${license}`,
  );
}
notices.push(
  "\n--- @exhibitos/spec 0.1.0-draft.2 browser document validators/schemas (Apache-2.0) ---\nCopyright 2026 ExhibitOS contributors\nDocument-only browser adaptation; original package bytes are pinned in vendor/.\n" +
    (await readFile("node_modules/@exhibitos/spec/LICENSE", "utf8")),
);
await mkdir("apps/web/public", { recursive: true });
await writeFile("apps/web/public/THIRD_PARTY_NOTICES.txt", notices.join("\n"));
console.log(
  `Preserved original notices for ${packages.length} bundled runtime packages.`,
);
