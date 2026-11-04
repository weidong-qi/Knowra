import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const requireFromWeb = createRequire(path.join(workspaceRoot, 'apps', 'web-legacy', 'package.json'));
const { build } = requireFromWeb('esbuild');

const entryFile = path.join(workspaceRoot, 'apps', 'web-legacy', 'lib', 'editor', 'milkdown-entry.js');
const outfile = path.join(workspaceRoot, 'apps', 'web-legacy', 'lib', 'editor', 'milkdown-bundle.js');
const outputCssFile = path.join(path.dirname(outfile), 'milkdown-bundle.css');
const isProductionBuild = process.env.NODE_ENV === 'production';

if (isProductionBuild) {
  for (const sourceMapFile of [`${outfile}.map`, `${outputCssFile}.map`]) {
    fs.rmSync(sourceMapFile, { force: true });
  }
}

await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile,
  sourcemap: !isProductionBuild,
  minify: isProductionBuild,
  logLevel: 'info',
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
  }
});
