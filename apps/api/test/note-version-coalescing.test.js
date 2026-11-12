import assert from 'node:assert/strict';
import { createKnowledgeModule } from '../src/modules/knowledge/index.ts';
import { selectCoalescibleVersion } from '../src/modules/knowledge/application/note-version-coalescing.ts';

const minute = 60 * 1000;
const at = offsetMs => new Date(Date.UTC(2026, 0, 1) + offsetMs).toISOString();
const version = (id, offsetMs, createdBy = 'user') => ({
  id,
  noteId: 'n1',
  contentHash: id.padEnd(64, '0'),
  createdAt: at(offsetMs),
  createdBy
});

function moduleWith(canDiscard) {
  const knowledge = createKnowledgeModule({ noteVersionCoalescing: canDiscard ? { canDiscard } : undefined });
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '长时间编辑', rawMarkdown: 'v0', spaceId: space.id });
  const start = Date.parse(note.updatedAt);
  const edit = (index, offsetMs) =>
    knowledge.noteService.updateNote(note.id, {
      rawMarkdown: `v${index}`,
      updatedAt: new Date(start + offsetMs).toISOString()
    });
  return {
    knowledge,
    note,
    edit,
    versions: () => knowledge.repositories.noteVersionRepository.list({ noteId: note.id })
  };
}

export const noteVersionCoalescingTests = [
  {
    name: '版本合并选择：需要基线检查点、同为用户保存且在窗口内',
    run() {
      const current = version('v3', 3 * minute);
      assert.equal(
        selectCoalescibleVersion({ versions: [version('v1', 0), version('v2', minute), current], current }).id,
        'v2'
      );
      assert.equal(
        selectCoalescibleVersion({ versions: [version('v2', minute), current], current }),
        null,
        '首个版本是基线'
      );
      assert.equal(
        selectCoalescibleVersion({ versions: [version('v1', 0), version('v2', minute, 'ai'), current], current }),
        null
      );
      const late = version('v4', 11 * minute);
      assert.equal(
        selectCoalescibleVersion({ versions: [version('v1', 0), version('v3', 10 * minute), late], current: late }),
        null,
        '窗口已过，上一个版本成为检查点'
      );
    }
  },
  {
    name: '连续自动保存在窗口内只保留基线与最新版本，窗口过后保留检查点',
    run() {
      const { edit, versions } = moduleWith(() => true);
      for (let index = 1; index <= 8; index++) edit(index, index * 30 * 1000);
      // 基线 v0 之后 10 分钟窗口内的连续保存只剩最新的 v8。
      assert.deepEqual(
        versions()
          .map(item => item.content)
          .sort(),
        ['v0', 'v8']
      );
      // 距基线已超过窗口：v8 成为检查点保留，随后的保存再次合并到最新版本。
      edit(9, 11 * minute);
      edit(10, 11 * minute + 30 * 1000);
      assert.deepEqual(
        versions()
          .map(item => item.content)
          .sort(),
        ['v0', 'v10', 'v8']
      );
    }
  },
  {
    name: '未提供 canDiscard 或被拒绝时不合并',
    run() {
      for (const gate of [null, () => false]) {
        const { edit, versions } = moduleWith(gate);
        for (let index = 1; index <= 4; index++) edit(index, index * 1000);
        assert.equal(versions().length, 5);
      }
    }
  },
  {
    name: '被标注、证据或题目来源引用的版本不会被合并',
    run() {
      const { knowledge, note, edit, versions } = moduleWith(() => true);
      edit(1, 1000);
      const referenced = versions().find(item => item.content === 'v1');
      knowledge.repositories.questionSourceRepository.list = () => [
        { id: 'qs1', sourceType: 'noteVersion', sourceId: referenced.id }
      ];
      edit(2, 2000);
      edit(3, 3000);
      assert.ok(
        versions().some(item => item.id === referenced.id),
        'v1 仍保留'
      );
      assert.ok(note.id);
    }
  }
];
