import { afterEach, expect, it, vi } from 'vitest';
import { captureBrowserBackupDrafts } from '../sync/backupDrafts';
import { createKnowledgeDraftRecovery, getKnowledgeDraftScope, KNOWLEDGE_DRAFT_PREFIX, type KnowledgeDraft } from './knowledgeDraftRecovery';

const initialValue = { title: '候选', canonicalStatement: '陈述', userExplanation: '', knowledgeType: 'concept' as const };
const draft: KnowledgeDraft = { version: 1, kind: 'create', candidateId: 'candidate-fixed', initialValue, value: { ...initialValue, title: '未保存的修改' }, source: { annotationId: 'a1', noteVersionId: 'v1', expectedAnnotationRevision: 3, quoteText: '原文', headingPath: ['旧标题'] } };
afterEach(() => { delete window.knowraDesktop; sessionStorage.clear(); vi.restoreAllMocks(); });

it('新存储实例恢复候选 id 和原来源；资料库恢复生成新 datasetId 后隔离旧草稿', async () => {
  const first = createKnowledgeDraftRecovery();
  const scope = getKnowledgeDraftScope({ persistenceMode: 'desktop-local', datasetId: 'before', legacyDraftsAllowed: true, cacheSuffix: '' });
  first.write(scope, draft); await first.flush();
  expect(createKnowledgeDraftRecovery().list(scope)).toEqual([draft]);
  expect(createKnowledgeDraftRecovery().list(getKnowledgeDraftScope({ persistenceMode: 'desktop-local', datasetId: 'after', legacyDraftsAllowed: true, cacheSuffix: '' }))).toEqual([]);
  expect(captureBrowserBackupDrafts().drafts[`${KNOWLEDGE_DRAFT_PREFIX}${JSON.stringify([scope, draft.candidateId])}`]).toEqual(draft);
});

it('串行保存最新输入，落盘失败拒绝恢复退出；删除也必须落盘确认', async () => {
  const disk: Record<string, unknown> = {};
  const write = vi.fn(async (key: string, value: unknown) => { if (value === null) delete disk[key]; else disk[key] = value; });
  window.knowraDesktop = { readRecoveryDrafts: () => disk, writeRecoveryDraft: write, onPrepareClose() {}, onCancelClose() {} };
  const store = createKnowledgeDraftRecovery();
  const latest = { ...draft, value: { ...draft.value, title: '最新输入' } };
  store.write('scope', draft); store.write('scope', latest); await store.flush();
  expect(createKnowledgeDraftRecovery().list('scope')).toEqual([latest]);
  write.mockRejectedValue(new Error('磁盘已满'));
  store.write('scope', draft);
  await expect(store.flush()).rejects.toThrow('磁盘已满');
  expect(store.list('scope')).toEqual([draft]);
  expect(createKnowledgeDraftRecovery().list('scope')).toEqual([latest]);
  store.remove('scope', draft);
  await expect(store.flush()).rejects.toThrow('磁盘已满');
  write.mockImplementation(async (key, value) => { if (value === null) delete disk[key]; else disk[key] = value; });
  await store.flush();
  expect(createKnowledgeDraftRecovery().list('scope')).toEqual([]);
});

it('拒绝缺失编辑基线的损坏草稿，保留原文件供救援', () => {
  const key = `${KNOWLEDGE_DRAFT_PREFIX}${JSON.stringify(['scope', draft.candidateId])}`;
  const broken = { ...draft, kind: 'edit', source: undefined };
  sessionStorage.setItem(key, JSON.stringify(broken));
  expect(() => createKnowledgeDraftRecovery().list('scope')).toThrow('知识恢复草稿格式无效');
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(broken);
});
