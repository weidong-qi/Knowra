import { Schema } from '@milkdown/kit/prose/model';
import { describe, expect, it } from 'vitest';
import { collectDocumentTextMatches, resolveMatchNavigationIndex } from './editorFind';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: { inline: true }
  }
});

describe('editorFind', () => {
  it('collects repeated text matches across document nodes', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('知识 知识')),
      schema.node('paragraph', null, schema.text('第二段知识'))
    ]);
    expect(collectDocumentTextMatches(doc, '知识')).toHaveLength(3);
    expect(collectDocumentTextMatches(doc, '  ')).toEqual([]);
  });

  it('wraps next and previous navigation indexes', () => {
    expect(resolveMatchNavigationIndex(-1, 3, 'next')).toBe(0);
    expect(resolveMatchNavigationIndex(2, 3, 'next')).toBe(0);
    expect(resolveMatchNavigationIndex(-1, 3, 'previous')).toBe(2);
    expect(resolveMatchNavigationIndex(0, 3, 'previous')).toBe(2);
    expect(resolveMatchNavigationIndex(0, 0, 'next')).toBe(-1);
  });
});
