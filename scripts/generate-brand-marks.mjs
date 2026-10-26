// Maintenance only; product builds use the checked-in generated modules.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const base = new URL("../apps/web/src/branding/", import.meta.url);
const pins = {
  studio: "39f9fd1b44ff2cb2ba32a5bc3c5b9f645dcc6c6f2c2aa30842d40cfb686912d4",
  viewer: "3c9f493b41f73257f75ebd271365968939ac7da8c60bba978a664b5fb9f96319",
  "exhibitos-wordmark": "487208ff2c4cbf60f188225c08fe38b217c1115f7becc76fc13f89b7c91526b6",
};
for (const [role, expected] of Object.entries(pins)) {
  const source = readFileSync(new URL(`canonical/${role}.svg`, base));
  if (createHash("sha256").update(source).digest("hex") !== expected) {
    throw new Error("CANONICAL_BRAND_SOURCE_CHANGED");
  }
  const svg = source.toString("utf8");
  if (role !== "studio") {
    // Frozen approved geometry; normalize XML namespace/React attributes only.
    const normalized = svg.replace(/<(\/?)ns\d+:/g, "<$1");
    const root = normalized.match(/^<svg\b[^>]*viewBox="([^"]+)"[^>]*>/);
    if (!root || !normalized.endsWith("</svg>") || /<(?:script|image|foreignObject)\b|\b(?:href|on\w+)\s*=|url\(/i.test(normalized)) throw Error("CANONICAL_BRAND_SHAPE_CHANGED");
    const body = normalized.slice(root[0].length, -6).replace(/<title>[\s\S]*?<\/title>/g, "").replace(/ id="[^"]*"/g, "")
      .replace(/stroke-linecap=/g,"strokeLinecap=").replace(/stroke-linejoin=/g,"strokeLinejoin=").replace(/stroke-width=/g,"strokeWidth=");
    const name = role === "viewer" ? "ViewerMark" : "ExhibitOSWordmark";
    const component = `// Generated from canonical/${role}.svg (${expected}).\n// Regenerate with node scripts/generate-brand-marks.mjs.\nexport function ${name}() {\n  return <svg viewBox="${root[1]}" width="${role === "viewer" ? 32 : 102}" height="${role === "viewer" ? 32 : 26}" aria-hidden="true" focusable="false">${body}</svg>;\n}\n`;
    writeFileSync(new URL(`${name}.tsx`,base),component);
    continue;
  }
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
