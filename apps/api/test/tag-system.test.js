import assert from 'node:assert/strict';
import { createKnowledgeModule } from '../src/modules/knowledge/index.ts';

export const tagSystemTests = [
  {
    name: '标签名在工作区内按大小写不敏感保持唯一',
    async run() {
      const module = createKnowledgeModule();
      module.tagService.createTag({ id: 'tag-a', spaceId: 'space-1', name: 'Paper' });
      assert.throws(
        () => module.tagService.createTag({ id: 'tag-b', spaceId: 'space-1', name: ' paper ' }),
        error => error.code === 'TAG_NAME_CONFLICT' && error.statusCode === 409
      );
    }
  },
  {
    name: '单选分组在单篇和批量标签更新时自动替换旧值',
    async run() {
      const module = createKnowledgeModule();
      const group = module.tagGroupService.createTagGroup({
        id: 'group-mastery',
        spaceId: 'space-1',
        name: '掌握程度',
        selectionMode: 'single'
      });
      const fuzzy = module.tagService.createTag({
        id: 'tag-fuzzy',
        spaceId: 'space-1',
        name: '模糊',
        groupId: group.id
      });
      const mastered = module.tagService.createTag({
        id: 'tag-mastered',
        spaceId: 'space-1',
        name: '已掌握',
        groupId: group.id
      });
      module.noteService.createNote({
        id: 'note-a',
        spaceId: 'space-1',
        title: 'A',
        rawMarkdown: '',
        tagIds: [fuzzy.id]
      });
      module.noteService.setNoteTags('note-a', [fuzzy.id, mastered.id]);
      assert.deepEqual(module.noteService.getNote('note-a').tagIds, [mastered.id]);
      module.noteService.updateTagsForNotes(['note-a'], [fuzzy.id], []);
      assert.deepEqual(module.noteService.getNote('note-a').tagIds, [fuzzy.id]);
    }
  },
  {
    name: '标签合并会迁移引用并去重，删除会清理全部引用',
    async run() {
      const module = createKnowledgeModule();
      module.tagService.createTag({ id: 'tag-source', spaceId: 'space-1', name: '来源' });
      module.tagService.createTag({ id: 'tag-target', spaceId: 'space-1', name: '目标' });
      module.noteService.createNote({
        id: 'note-a',
        spaceId: 'space-1',
        title: 'A',
        rawMarkdown: '',
        tagIds: ['tag-source', 'tag-target']
      });
      module.mergeTags('tag-source', 'tag-target');
      assert.deepEqual(module.noteService.getNote('note-a').tagIds, ['tag-target']);
      assert.equal(
        module.tagService.listTags().some(tag => tag.id === 'tag-source'),
        false
      );
      module.deleteTagAndCleanup('tag-target');
      assert.deepEqual(module.noteService.getNote('note-a').tagIds, []);
    }
  },
  {
    name: '已有标签的分组不允许直接改变选择模式',
    async run() {
      const module = createKnowledgeModule();
      const group = module.tagGroupService.createTagGroup({
        id: 'group-custom',
        spaceId: 'space-1',
        name: '自定义',
        selectionMode: 'multiple'
      });
      module.tagService.createTag({ id: 'tag-child', spaceId: 'space-1', name: '子标签', groupId: group.id });
      assert.throws(
        () => module.tagGroupService.updateTagGroup(group.id, { selectionMode: 'single' }),
        error => error.code === 'TAG_GROUP_IN_USE' && error.statusCode === 409
      );
    }
  }
];
