import { readFile, mkdir, writeFile } from "node:fs/promises";
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
  let root;
  try {
    root = dirname(resolveWeb.resolve(`${name}/package.json`));
  } catch {
    root = `node_modules/${name}`;
  }
  const metadata = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
  let license;
  try {
    license = await readFile(`${root}/LICENSE`, "utf8");
  } catch {
    license = await readFile(`${root}/LICENSE.md`, "utf8");
  }
  notices.push(
    `\n--- ${name} ${metadata.version} (${metadata.license}) ---\n\n${license}`,
  );
}
notices.push(
  "\n--- @exhibitos/spec 0.1.0-draft.1 browser document validators/schemas (Apache-2.0) ---\nCopyright 2026 ExhibitOS contributors\nDocument-only browser adaptation; original package bytes are pinned in vendor/.\n" +
    (await readFile("node_modules/@exhibitos/spec/LICENSE", "utf8")),
);
await mkdir("apps/web/public", { recursive: true });
await writeFile("apps/web/public/THIRD_PARTY_NOTICES.txt", notices.join("\n"));
console.log(
  `Preserved original notices for ${packages.length} bundled runtime packages.`,
);
