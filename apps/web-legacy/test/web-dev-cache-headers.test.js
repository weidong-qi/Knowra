import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mainJs = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
const staticAssetsJs = fs.readFileSync(path.resolve(__dirname, '../src/server/static-assets.js'), 'utf8');

assert.match(
  mainJs,
  /'Cache-Control': 'no-store'/,
  'web server should keep the SSR homepage uncached'
);
assert.match(
  staticAssetsJs,
  /public, max-age=0, must-revalidate/,
  'static modules should support browser revalidation instead of disabling storage'
);
assert.match(
  staticAssetsJs,
  /fs\.createReadStream\(filePath\)/,
  'large static assets should be streamed instead of read synchronously'
);
assert.doesNotMatch(
  staticAssetsJs,
  /fs\.readFileSync\(filePath\)/,
  'static asset requests should not block the event loop with synchronous reads'
);
assert.match(
  mainJs,
  /\['GET', 'HEAD'\]\.includes\(request\.method\) && url\.pathname === '\/'/,
  'web dev server should answer HEAD requests for the homepage so load balancers and probes do not see false 404s'
);
assert.match(
  staticAssetsJs,
  /pathname\.startsWith\('\/src\/services\/'\)/,
  'web dev server should serve frontend service modules imported by client.js'
);
assert.match(
  staticAssetsJs,
  /pathname\.startsWith\('\/src\/controllers\/'\)/,
  'web dev server should serve frontend controller modules imported by client.js'
);
assert.match(
  staticAssetsJs,
  /\['\.svg', 'image\/svg\+xml; charset=utf-8'\]/,
  'web dev server should serve the Phosphor icon assets with the SVG MIME type'
);

console.log('ok - web shell and static assets use their intended cache policies');
