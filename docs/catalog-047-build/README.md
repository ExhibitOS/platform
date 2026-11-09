# Build the Platform catalog 047 native payload

This recipe corresponds to Platform [7ad04db](https://github.com/ExhibitOS/platform/tree/7ad04db38db884ffc7dfd32d803aaf5bf08b0aa5), Git tree `7755e7c7e01eb156277be64e75c8a47d01b5e381`. It describes the unsigned macOS arm64 payload and its selected inputs. The runtime manifest of the retained candidate is `5349fc033df2460361c98d7ea2184565f6635a94df7352a35b74f0f5286b842f`. Your build creates a manifest for its own bytes.

## Inputs

- Use Node [24.21.0 for darwin-arm64](https://nodejs.org/dist/v24.21.0/) and npm 11.19.0. The packaged Node executable has SHA-256 `e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b` and its license `5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace`. The Platform package lock in the pinned checkout specifies the npm sources, including the checked-in Spec tarball and platform-specific Sharp and libvips packages.
- Use PostgreSQL 18.6 from the [Postgres.app v2.9.6 PostgreSQL 18 disk image](https://github.com/PostgresApp/PostgresApp/releases/download/v2.9.6/Postgres-2.9.6-18.dmg). Its asset ID is `512422981` and SHA-256 is `9fc7d0dc08cf46dfd94bb32cbaaad81b41b37847a42d6dcb2f9fbd292813defb`. Copy the `Postgres.app/Contents/Versions/18` tree into a private build directory with its relative links preserved. The producer selects `managed-core-v1` and checks that links resolve within the input tree. Upstream source and supplier changes are pinned in the [Postgres.app build recipe](https://github.com/PostgresApp/PostgresApp/blob/0e7a7084f7467ceacbaf757019b6e9bb1fb5ab7d/src-18/makefile) and [supplier patch](https://github.com/PostgresApp/PostgresApp/blob/0e7a7084f7467ceacbaf757019b6e9bb1fb5ab7d/src-18/patches/fd.c.patch).
- Check out [ExhibitOS/default-furnishings](https://github.com/ExhibitOS/default-furnishings/tree/4ac7d23c1b557d8e303ad04d78379bcefab50b40) at `4ac7d23c1b557d8e303ad04d78379bcefab50b40` as a Git working tree. The producer checks that commit and the release manifest SHA-256 `f11ba6f4407e31531230cdb94921d7d7baef3caca49b1859f8696fa1a39c4530`.
- For a local replacement of the packaged libvips and Sharp inputs, use the [pinned macOS recipient recipe](../../scripts/recipient-libvips/README.md). That separate path changes the local runtime inventory and uses Manager's local source admission.

## Build the runtime

In a clean detached Platform checkout at the commit above, with the selected Node and npm on `PATH`:

```sh
npm ci --no-audit --no-fund --ignore-scripts
npm run build
(
  cd apps/web
  EXHIBITOS_STATIC_TARGET=viewer EXHIBITOS_PRIVATE_EDITOR=1 \
    ../../node_modules/.bin/vite build --config vite.static.config.ts
  ../../node_modules/.bin/vite build --config vite.cover.config.ts
)
```

The selected package reused the already verified outputs from the cover trim review at `c0b7d3cc61eeedcca56c24144858377af52a6026`. Those outputs included the exact previous `dist-static` bytes from [Platform 273b0bb](https://github.com/ExhibitOS/platform/tree/273b0bbb054b357c3ac7d5a354ff78924747734d), built with the same Viewer and private editor settings above. The static Viewer sources, settings and runtime consumers were unchanged. An independent static rebuild grouped some JS chunks differently. The [static Viewer checksums](retained-static-viewer.sha256) identify the files actually reused. To verify a retained copy, run `shasum -a 256 -c /absolute/path/to/retained-static-viewer.sha256` from its `apps/web/dist-static` directory. Keep any new build's own manifest if its bytes differ. The native cover companion uses the 7ad04db build configuration, which omits duplicate browser assets from that companion's output.

The [selection file](selection.json) records every non-path configuration value used for the selected package. Create a config by adding six canonical absolute paths. Set the variables below to your own private build inputs. Keep the config and source receipt outside the Platform checkout.

```sh
export NODE_BINARY NODE_LICENSE NPM_CLI POSTGRES_ROOT POSTGRES_SOURCE_RECEIPT FURNISHINGS_ROOT
export SELECTION_FILE PACKAGE_CONFIG OUTPUT_DIRECTORY
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const selection = JSON.parse(readFileSync(process.env.SELECTION_FILE, 'utf8'));
const paths = {
  nodeBinary: 'NODE_BINARY', nodeLicense: 'NODE_LICENSE', npmCLI: 'NPM_CLI',
  postgresRoot: 'POSTGRES_ROOT', postgresSourceReceipt: 'POSTGRES_SOURCE_RECEIPT',
  defaultFurnishingsRoot: 'FURNISHINGS_ROOT',
};
for (const [key, env] of Object.entries(paths)) {
  const path = process.env[env];
  if (!path?.startsWith('/')) throw Error(`Set ${env} to a canonical absolute path`);
  selection[key] = path;
}
writeFileSync(process.env.PACKAGE_CONFIG, JSON.stringify(selection, null, 2) + '\n', { flag: 'wx' });
JS
node scripts/package-native-runtime.mjs "$OUTPUT_DIRECTORY" "$PACKAGE_CONFIG"
shasum -a 256 "$OUTPUT_DIRECTORY/manifest.json"
```

Set `NODE_LICENSE` to the Node distribution's `LICENSE`. Set `NPM_CLI` to the exact npm installation's `bin/npm-cli.js`. Verify the downloaded disk image before writing the PostgreSQL supplier receipt at `POSTGRES_SOURCE_RECEIPT`. Its JSON has these fields:

```json
{
  "release": "v2.9.6",
  "assetID": 512422981,
  "sha256": "9fc7d0dc08cf46dfd94bb32cbaaad81b41b37847a42d6dcb2f9fbd292813defb",
  "source": "https://github.com/PostgresApp/PostgresApp/releases/download/v2.9.6/Postgres-2.9.6-18.dmg"
}
```

The destination must be new. The producer installs pinned production dependencies there, copies only the selected inputs, and writes the inventory. The output is a local-validation runtime. For a separately built local Manager app, use the [Manager recipient build procedure](https://github.com/ExhibitOS/manager/blob/9b4483471473200772d7db0012afafc3dd0ce9df/docs/native-recipient-build.md). Official Manager admission uses the separately finalized Developer ID runtime and its exact release manifest.
