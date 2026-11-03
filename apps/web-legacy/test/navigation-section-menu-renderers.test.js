import assert from 'node:assert/strict';
import {
  SECONDARY_SECTION_ITEMS,
  renderSectionMenuItems
} from '../lib/navigation/section-menu-renderers.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('SECONDARY_SECTION_ITEMS keeps the expected left navigation sections', () => {
  assert.deepEqual(SECONDARY_SECTION_ITEMS, [
    { key: 'favorites', label: '收藏' },
    { key: 'recent', label: '最近' },
    { key: 'recycle', label: '回收站' }
  ]);
});

runTest('renderSectionMenuItems renders checked and unchecked section toggles', () => {
  const html = renderSectionMenuItems({
    sections: { favorites: true, recent: false, recycle: true }
  });

  assert.match(html, /data-section-toggle="favorites"/);
  assert.match(html, /data-section-toggle="recent"/);
  assert.match(html, /data-section-toggle="recycle"/);
  assert.match(html, /<span class="library-checkmark"><span class="semantic-icon library-checkmark-icon"[\s\S]*data-icon="confirm"[\s\S]*remix\/check-line\.svg\)"[\s\S]*<\/span><\/span>\s*<span>收藏<\/span>/);
  assert.match(html, /<span class="library-checkmark"><\/span>\s*<span>最近<\/span>/);
});

runTest('renderSectionMenuItems escapes custom labels and keys', () => {
  const html = renderSectionMenuItems({
    items: [{ key: 'x" autofocus="true', label: '<危险&>' }],
    sections: { 'x" autofocus="true': true }
  });

  assert.match(html, /data-section-toggle="x&quot; autofocus=&quot;true"/);
  assert.match(html, /&lt;危险&amp;&gt;/);
  assert.doesNotMatch(html, /<危险&>/);
});
