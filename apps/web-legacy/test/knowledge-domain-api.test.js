import assert from 'node:assert/strict';
import { createKnowledgeDomainApi } from '../src/services/knowledge-api/knowledge-domain-service.js';

const calls = [];
const api = createKnowledgeDomainApi({
  async requestJson(url, options = {}) {
    calls.push({ url, options });
    if (url.includes('/versions')) return { data: [{ id: 'version-1' }] };
    if (url.startsWith('/api/knowledge/items?')) return { data: [{ id: 'item-1' }] };
    if (url.endsWith('/confirm')) return { data: { id: 'item-1', reviewStatus: 'confirmed' } };
    return { data: { item: { id: 'item-1' }, evidence: [] } };
  }
});

assert.deepEqual(await api.listNoteVersions('note/1'), [{ id: 'version-1' }]);
assert.deepEqual(await api.listKnowledgeItems({ includeArchived: true }), [{ id: 'item-1' }]);
assert.equal((await api.createKnowledgeItem({ title: '候选' })).item.id, 'item-1');
assert.equal((await api.confirmKnowledgeItem('item/1')).reviewStatus, 'confirmed');
assert.match(calls[0].url, /notes\/note%2F1\/versions$/);
assert.match(calls[1].url, /includeArchived=true/);

console.log('ok - knowledge domain API keeps Phase2 routes encoded and asynchronous');
