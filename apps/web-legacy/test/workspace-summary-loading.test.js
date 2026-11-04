import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceApi } from '../src/services/knowledge-api/workspace-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const initialWorkspaceSource = fs.readFileSync(
  path.resolve(__dirname, '../src/server/initial-workspace.js'),
  'utf8'
);

assert.match(
  initialWorkspaceSource,
  /knowledge\/notes\?spaceId=.*summaryOnly=true/,
  'SSR bootstrap should request compact note summaries'
);

const requests = [];
const api = createWorkspaceApi({
  requestJson: async (url) => {
    requests.push(url);
    return { data: [] };
  }
});

await api.loadWorkspaceResources('space-1');
assert.ok(
  requests.some((url) => url.includes('/api/knowledge/notes?')
    && url.includes('includeDeleted=true')
    && url.includes('summaryOnly=true'))
);

await api.searchNoteIds({ query: 'transformer', spaceId: 'space-1' });
assert.ok(requests.some((url) => url.includes('/api/knowledge/search/notes?')
  && url.includes('includeDeleted=true')
  && url.includes('result=ids')));

console.log('ok - workspace bootstrap loads summaries and keeps server-side full-text search');
