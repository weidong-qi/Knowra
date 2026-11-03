import assert from 'node:assert/strict';
import { stripLegacyGeneratedTitle } from '../lib/notes/legacy-title.js';

assert.equal(stripLegacyGeneratedTitle({
  markdown: '# Legacy title\n\nFirst paragraph',
  title: 'Legacy title',
  sourceType: 'manual'
}), 'First paragraph');

assert.equal(stripLegacyGeneratedTitle({
  markdown: '# Imported heading\n\nBody',
  title: 'Imported heading',
  sourceType: 'markdown-import'
}), '# Imported heading\n\nBody');

assert.equal(stripLegacyGeneratedTitle({
  markdown: '# Different heading\n\nBody',
  title: 'Saved title',
  sourceType: 'manual'
}), '# Different heading\n\nBody');

console.log('ok - legacy manual titles are removed only when they duplicate the document title');
