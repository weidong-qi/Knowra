import assert from 'node:assert/strict';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createInMemoryContentAnnotationRepository } from '../src/modules/knowledge/infrastructure/content-annotation-repository.ts';
import { createInMemoryAnalysisScopeRepository } from '../src/modules/knowledge/infrastructure/annotation-support-repositories.ts';
import { createAnnotationScopeService } from '../src/modules/knowledge/application/annotation-scope-service.ts';
import { annotationOf, markText } from './fixtures/inline-annotation-seed.js';

export const assetLifecycleStage1Tests = [
  {
    name: '阶段1 笔记删除包记录子标注原状态，恢复不复活独立删除的标注',
    run() {
      const annotations = createInMemoryContentAnnotationRepository();
      const knowledge = createKnowledgeModule({ contentAnnotationRepository: annotations });
      knowledge.noteService.createNote({ id: 'n1', spaceId: 's1', title: '笔记', rawMarkdown: '正文' });
      annotations.save({ id: 'a-active', noteId: 'n1', lifecycleStatus: 'active', revision: 2 });
      annotations.save({ id: 'a-deleted', noteId: 'n1', lifecycleStatus: 'deleted', revision: 4 });
      const deleted = knowledge.noteService.deleteNote('n1');
      assert.equal(deleted.deleted, true);
      assert.deepEqual(
        deleted.deletionPackage.annotationStates.map(item => [item.id, item.lifecycleStatus]),
        [
          ['a-active', 'active'],
          ['a-deleted', 'deleted']
        ]
      );
      knowledge.noteService.restoreNote('n1');
      assert.equal(annotations.findById('a-active').lifecycleStatus, 'active');
      assert.equal(annotations.findById('a-deleted').lifecycleStatus, 'deleted');
    }
  },
  {
    name: '阶段1 知识点回收站独立于归档和审核，来源撤回不改技术健康',
    run() {
      const knowledge = createKnowledgeModule();
      const service = knowledge.knowledgeItemService;
      const created = service.createCandidate({
        id: 'k1',
        title: '概念',
        canonicalStatement: '陈述',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'manual', quoteText: '历史摘录' }]
      });
      const confirmed = service.confirmItem('k1');
      const retired = service.retireEvidence('k1', created.evidence[0].id);
      assert.equal(retired.evidence.status, 'valid');
      assert.equal(retired.evidence.applicabilityStatus, 'withdrawn');
      assert.equal(retired.item.reviewStatus, 'needsRevision');
      assert.equal(service.trash('k1').reviewStatus, 'needsRevision');
      assert.equal(service.listItems().length, 0);
      assert.equal(service.listItems({ includeDeleted: true }).length, 1);
      assert.equal(service.restoreDeleted('k1').reviewStatus, 'needsRevision');
      const archived = service.archive('k1');
      const trashedArchived = service.trash('k1', { expectedUpdatedAt: archived.updatedAt });
      assert.equal(
        service.restoreDeleted('k1', { expectedUpdatedAt: trashedArchived.updatedAt }).reviewStatus,
        'archived'
      );
      assert(Date.parse(confirmed.updatedAt) <= Date.parse(retired.item.updatedAt));
    }
  },
  {
    name: '阶段1 取消重点（删掉正文标记）保留可复核证据并提示原重点已移除；加回标记后恢复',
    run() {
      const knowledge = createKnowledgeModule();
      const marked = `${markText('可验证的原', 'ev')}文摘录`;
      const note = knowledge.noteService.createNote({
        id: 'source-note',
        spaceId: 's1',
        title: '来源',
        rawMarkdown: marked
      });
      const annotation = annotationOf(knowledge, note.id, 'ev');
      const { item } = knowledge.knowledgeItemService.createCandidate({
        title: '来源知识',
        canonicalStatement: '原文摘录有依据',
        sourceMode: 'annotation',
        evidence: [
          { sourceType: 'annotation', annotationId: annotation.id, expectedAnnotationRevision: annotation.revision }
        ]
      });
      const current = knowledge.noteService.updateNote(note.id, { rawMarkdown: '可验证的原文摘录' });
      assert.equal(knowledge.contentAnnotationService.getAnnotation(annotation.id).lifecycleStatus, 'deleted');
      const historical = knowledge.knowledgeItemService.listEvidence(item.id)[0];
      assert.equal(historical.sourceAnnotationRemoved, true);
      assert.equal(historical.status, 'valid');
      knowledge.noteService.updateNote(note.id, { rawMarkdown: marked, expectedUpdatedAt: current.updatedAt });
      assert.equal(knowledge.contentAnnotationService.getAnnotation(annotation.id).lifecycleStatus, 'active');
      assert.equal(knowledge.knowledgeItemService.listEvidence(item.id)[0].sourceAnnotationRemoved, false);
    }
  },
  {
    name: '阶段1 已保存分析范围可列出、回收和恢复，旧快照内容保持不变',
    run() {
      const record = {
        id: 'scope-1',
        spaceId: 's1',
        inputHash: 'hash',
        idempotencyKey: 'key',
        noteVersions: [],
        selections: [],
        segments: [],
        contextSegments: [],
        exclusions: [],
        omittedItems: [],
        annotationRevisions: [],
        summary: { noteCount: 0, segmentCount: 0, annotationCount: 0 },
        createdAt: '2026-09-23T00:00:00.000Z',
        updatedAt: '2026-09-23T00:00:00.000Z',
        deletedAt: null
      };
      const repository = createInMemoryAnalysisScopeRepository({ records: [record] });
      const service = createAnnotationScopeService({ analysisScopeRepository: repository });
      assert.equal(service.listAnalysisScopes({ spaceId: 's1' }).length, 1);
      const deleted = service.trashAnalysisScope('scope-1', { spaceId: 's1', expectedUpdatedAt: record.updatedAt });
      assert.equal(service.listAnalysisScopes({ spaceId: 's1' }).length, 0);
      assert.equal(service.listAnalysisScopes({ spaceId: 's1', includeDeleted: true }).length, 1);
      assert.deepEqual(deleted.segments, record.segments);
      assert.throws(
        () => service.restoreAnalysisScope('scope-1', { spaceId: 's1', expectedUpdatedAt: record.updatedAt }),
        { code: 'ANALYSIS_SCOPE_UPDATE_CONFLICT' }
      );
      assert.equal(
        service.restoreAnalysisScope('scope-1', { spaceId: 's1', expectedUpdatedAt: deleted.updatedAt }).deletedAt,
        null
      );
    }
  },
  {
    name: '阶段1 知识点回收站使正式学习目标退出使用，但保留目标身份与引用',
    run() {
      const knowledge = createKnowledgeModule();
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'k-objective',
        title: '目标依据',
        canonicalStatement: '可核对的概念陈述',
        sourceMode: 'manual'
      }).item;
      knowledge.knowledgeItemService.confirmItem(item.id);
      const objective = knowledge.learningObjectiveService.createCandidate({
        id: 'objective-1',
        knowledgeItemId: item.id,
        objective: '能够解释该概念的含义',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });
      knowledge.learningObjectiveService.confirmObjective(objective.id);
      knowledge.knowledgeItemService.trash(item.id);
      const retained = knowledge.learningObjectiveService.getObjective(objective.id);
      assert.equal(retained.knowledgeItemId, item.id);
      assert.equal(retained.reviewStatus, 'candidate');
      assert.equal(
        knowledge.knowledgeItemService.listItems().some(record => record.id === item.id),
        false
      );
    }
  },
  {
    name: '阶段1 文件夹保留移动与组合删除均可恢复，先前独立删除的笔记保持删除',
    run() {
      const knowledge = createKnowledgeModule();
      const { folderService, noteService } = knowledge;
      folderService.createFolder({ id: 'root', spaceId: 's1', name: '原目录' });
      folderService.createFolder({ id: 'child', spaceId: 's1', parentId: 'root', name: '子目录' });
      folderService.createFolder({ id: 'dest', spaceId: 's1', name: '目标' });
      noteService.createNote({
        id: 'active',
        spaceId: 's1',
        folderId: 'child',
        title: '现有笔记',
        rawMarkdown: '正文'
      });
      noteService.createNote({
        id: 'independent',
        spaceId: 's1',
        folderId: 'child',
        title: '先前删除',
        rawMarkdown: '正文'
      });
      noteService.deleteNote('independent');
      const moved = knowledge.deleteFolderAndCleanup('root', { mode: 'keep', destinationId: 'dest' });
      assert.equal(moved.deletionPackage.mode, 'keep');
      assert.equal(noteService.getNote('active').folderId, 'dest');
      knowledge.restoreDeletedFolder('root');
      assert.equal(noteService.getNote('active').folderId, 'dest');
      noteService.updateNote('active', { folderId: 'child' });
      const combined = knowledge.deleteFolderAndCleanup('root', { mode: 'with-content' });
      assert.deepEqual(combined.deletionPackage.noteIds, ['active']);
      knowledge.restoreDeletedFolder('root');
      assert.equal(noteService.getNote('active').deleted, false);
      assert.equal(noteService.getNote('independent', { includeDeleted: true }).deleted, true);
    }
  }
];
