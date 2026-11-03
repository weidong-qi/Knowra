import assert from 'node:assert/strict';

import {
  buildTagInput,
  buildUniqueTagId,
  findTagByName,
  normalizeTagName,
  removeTagFromCollections,
  upsertTag
} from '../lib/tags/state.js';
import { RUNTIME_COLOR_FALLBACKS } from '../lib/theme/runtime-colors.js';

const tags = [
  { id: 'tag-clip', name: 'CLIP' },
  { id: 'tag-memory', name: 'Memory' }
];

assert.deepEqual(
  upsertTag(tags, { id: 'tag-new', name: 'New' }),
  [...tags, { id: 'tag-new', name: 'New' }],
  'upsertTag should append a new tag'
);

assert.deepEqual(
  upsertTag(tags, { id: 'tag-memory', name: 'Long-term Memory' }),
  [
    { id: 'tag-clip', name: 'CLIP' },
    { id: 'tag-memory', name: 'Long-term Memory' }
  ],
  'upsertTag should replace an existing tag by id'
);

assert.deepEqual(
  removeTagFromCollections(
    {
      tags,
      allNotes: [
        { id: 'note-1', tagIds: ['tag-clip', 'tag-memory'] },
        { id: 'note-2', tagIds: ['tag-memory'] }
      ],
      selectedTagIds: ['tag-clip', 'tag-memory']
    },
    'tag-memory'
  ),
  {
    tags: [{ id: 'tag-clip', name: 'CLIP' }],
    allNotes: [
      { id: 'note-1', tagIds: ['tag-clip'] },
      { id: 'note-2', tagIds: [] }
    ],
    selectedTagIds: ['tag-clip']
  },
  'removeTagFromCollections should remove the tag from tags, notes, and search filters'
);

assert.equal(
  buildUniqueTagId(' CLIP basics! ', tags),
  'tag-clip-basics',
  'buildUniqueTagId should slugify tag names'
);

assert.equal(
  buildUniqueTagId('CLIP', tags),
  'tag-clip-2',
  'buildUniqueTagId should avoid existing ids'
);

assert.equal(
  normalizeTagName('  New Tag  '),
  'New Tag',
  'normalizeTagName should trim input'
);

assert.deepEqual(
  findTagByName(tags, ' clip '),
  { id: 'tag-clip', name: 'CLIP' },
  'findTagByName should match names case-insensitively'
);

assert.equal(
  findTagByName(tags, ''),
  null,
  'findTagByName should ignore empty names'
);

assert.deepEqual(
  buildTagInput({ name: ' New Tag ', tags, spaceId: 'space-1' }),
  {
    id: 'tag-new-tag',
    spaceId: 'space-1',
    name: 'New Tag',
    color: RUNTIME_COLOR_FALLBACKS.accent
  },
  'buildTagInput should create the default tag payload'
);

assert.equal(
  buildTagInput({
    name: 'Unsafe Color',
    tags,
    spaceId: 'space-1',
    color: 'red; position: fixed'
  }).color,
  RUNTIME_COLOR_FALLBACKS.accent,
  'buildTagInput should replace unsafe runtime colors with the theme fallback'
);

assert.equal(
  buildTagInput({
    name: 'Invalid Hex',
    tags,
    spaceId: 'space-1',
    color: '#12345'
  }).color,
  RUNTIME_COLOR_FALLBACKS.accent,
  'buildTagInput should accept only valid 3, 4, 6, or 8 digit hex colors'
);

assert.equal(
  buildTagInput({ name: ' ', tags, spaceId: 'space-1' }),
  null,
  'buildTagInput should return null for empty names'
);

console.log('ok - tag state helpers update pure collections');
