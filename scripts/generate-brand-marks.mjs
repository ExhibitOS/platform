// Maintenance only; product builds use the checked-in generated modules.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const base = new URL("../apps/web/src/branding/", import.meta.url);
const pins = {
  studio: "39f9fd1b44ff2cb2ba32a5bc3c5b9f645dcc6c6f2c2aa30842d40cfb686912d4",
  viewer: "8b41482e75dc9eb0ebe97793fbd253eb4b2e79ae87a53ee0284f622dc5014455",
};
for (const [role, expected] of Object.entries(pins)) {
  const source = readFileSync(new URL(`canonical/${role}.svg`, base));
  if (createHash("sha256").update(source).digest("hex") !== expected) {
    throw new Error("CANONICAL_BRAND_SOURCE_CHANGED");
  }
  const svg = source.toString("utf8");
  const start = svg.indexOf('  <g id="mark"');
  if (start < 0 || !svg.endsWith("</svg>\n")) throw new Error("CANONICAL_BRAND_SHAPE_CHANGED");
  const body = svg.slice(start, svg.lastIndexOf("</svg>"))
    .replace(/ id="[^"]*"/g, "")
    .replace(/stroke-linecap=/g, "strokeLinecap=")
    .replace(/stroke-linejoin=/g, "strokeLinejoin=")
    .replace(/stroke-width=/g, "strokeWidth=");
  const name = role === "studio" ? "StudioMark" : "ViewerMark";
  const component = `// Generated from canonical/${role}.svg (${expected}).\n// Regenerate with node scripts/generate-brand-marks.mjs.\nexport function ${name}() {\n  return (\n    <svg viewBox="0 0 128 128" width="32" height="32" aria-hidden="true" focusable="false" style={{ verticalAlign: "middle", marginRight: 8 }}>\n${body}    </svg>\n  );\n}\n`;
  writeFileSync(new URL(`${name}.tsx`, base), component);
}
