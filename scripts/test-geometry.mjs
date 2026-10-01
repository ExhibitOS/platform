import { runGeometryBrowser } from "./geometry-browser.mjs";
console.log(
  JSON.stringify(
    {
      validation:
        "actual Chromium production geometry, IndexedDB and offline shell",
      ...(await runGeometryBrowser()),
    },
    null,
    2,
  ),
);
