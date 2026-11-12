import { useEffect, useState } from 'react';
import {
  conceptCounts,
  conceptItemLinks,
  searchConcepts,
  type ConceptCommand,
  type KnowledgeConcept,
  type KnowledgeItem
} from '@study-accelerator/web-core';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  LoadingState,
  PressableButton,
  SearchBox,
  Select
} from '../../../components/ui';
import { randomId } from '../../../browser/randomId';
import { knowledgeTypeLabel } from '../knowledgeViewModel';
import { sharedConceptStore, useConceptState } from './conceptStore';
import { ConceptEditor } from './ConceptEditor';
import { LinkItemsDialog, RemoveLinksDialog } from './ConceptLinkDialogs';
import styles from './Concepts.module.css';
export interface ConceptWorkspaceProps {
  selectedId: string | null;
  canWrite: boolean;
  refreshKey?: number;
  onSelect(id: string | null): void;
  onOpenItem(id: string): void;
  onListItems(): Promise<KnowledgeItem[]>;
}
export function ConceptWorkspace({
  selectedId,
  canWrite,
  refreshKey,
  onSelect,
  onOpenItem,
  onListItems
}: ConceptWorkspaceProps) {
  const store = sharedConceptStore();
  const state = useConceptState(store);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [itemError, setItemError] = useState('');
  const [itemsReady, setItemsReady] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [editor, setEditor] = useState<KnowledgeConcept | 'new' | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [removal, setRemoval] = useState<{ ids: string[]; move: boolean } | null>(null);
  const [action, setAction] = useState<'merge' | 'delete' | null>(null);
  const [targetId, setTargetId] = useState('');
  useEffect(() => {
    void store.load();
  }, [store, refreshKey]);
  useEffect(() => {
    let active = true;
    setItemsReady(false);
    setItemError('');
    void onListItems()
      .then(rows => {
        if (active) {
          setItems(rows);
          setItemsReady(true);
        }
      })
      .catch(error => {
        if (active) setItemError(error instanceof Error ? error.message : '知识点加载失败');
      });
    return () => {
      active = false;
    };
  }, [onListItems, refreshKey]);
  useEffect(() => {
    setSelection([]);
    setAction(null);
    setLinkOpen(false);
    setRemoval(null);
  }, [selectedId]);
  const write = canWrite && state.status === 'ready' && !state.unavailable && itemsReady;
  const concept = state.concepts.find(row => row.id === selectedId && !row.deletedAt);
  const links = concept ? conceptItemLinks(state, items).filter(row => row.conceptId === concept.id) : [];
  const run = async (command: ConceptCommand) => {
    if (!write) return false;
    try {
      await store.execute(command);
      return true;
    } catch {
      return false;
    }
  };
  const base = (row: KnowledgeConcept) => ({ id: row.id, expectedRevision: row.revision, operationId: randomId() });
  const confirmAction = async () => {
    if (!write || !concept) return;
    const target = state.concepts.find(row => row.id === targetId && !row.deletedAt);
    try {
      if (action === 'merge' && target) {
        await store.execute({
          ...base(concept),
          type: 'mergeConcept',
          targetId: target.id,
          expectedTargetRevision: target.revision
        });
        onSelect(target.id);
      } else if (action === 'delete') {
        await store.execute({ ...base(concept), type: 'deleteConcept' });
        onSelect(null);
      }
      setAction(null);
    } catch {
      /* 保留弹窗。 */
    }
  };
  const candidates = searchConcepts(state, query).filter(row =>
    filter === 'archived' ? row.reviewStatus === 'archived' : row.reviewStatus !== 'archived' && row.focus === filter
  );
  const groups = new Map<string, typeof links>();
  for (const link of links) {
    const type = items.find(item => item.id === link.knowledgeItemId)?.knowledgeType ?? 'concept';
    groups.set(type, [...(groups.get(type) ?? []), link]);
  }
  return (
    <section className={styles.workspace} aria-label="概念工作区">
      {state.error ? (
        <p role="alert">
          {state.error}
          <Button variant="ghost" onPress={() => void store.load()}>
            重新加载概念
          </Button>
        </p>
      ) : null}
      {itemError ? <p role="alert">{itemError}</p> : null}
      {state.status === 'loading' || state.status === 'idle' ? <LoadingState label="正在加载概念…" /> : null}
      {state.unavailable ? <p>当前资料库暂不支持概念，请升级云端与 Mac 应用。</p> : null}
      {state.undo ? (
        <div className={styles.toolbar} role="status">
          <span>概念已删除，知识点正文保留。</span>
          {write ? (
            <Button
              onPress={() => {
                const undo = state.undo!;
                void run({
                  type: 'undeleteConcept',
                  operationId: randomId(),
                  id: undo.id,
                  expectedRevision: undo.revision
                }).then(saved => {
                  if (saved) store.dismissUndo();
                });
              }}
            >
              撤销删除
            </Button>
          ) : null}
          <Button variant="ghost" onPress={() => store.dismissUndo()}>
            关闭提示
          </Button>
        </div>
      ) : null}
      {concept ? (
        <>
          <div className={styles.toolbar}>
            <Button variant="ghost" onPress={() => onSelect(null)}>
              返回概念列表
            </Button>
          </div>
          <header>
            <h1>{concept.name}</h1>
            {concept.sense ? <p>{concept.sense}</p> : null}
            <p>别名：{concept.aliases.join('、') || '暂无'}</p>
          </header>
          {write ? (
            <div className={styles.toolbar}>
              <Button onPress={() => setEditor(concept)} isDisabled={state.pending}>
                编辑概念
              </Button>
              <Button
                onPress={() =>
                  void run({
                    ...base(concept),
                    type: 'updateConcept',
                    patch: { focus: concept.focus === 'active' ? 'muted' : 'active' }
                  })
                }
                isDisabled={state.pending}
              >
                {concept.focus === 'active' ? '不再关注' : '关注概念'}
              </Button>
              <Button
                onPress={() =>
                  void run({
                    ...base(concept),
                    type: concept.reviewStatus === 'archived' ? 'restoreConcept' : 'archiveConcept'
                  })
                }
                isDisabled={state.pending}
              >
                {concept.reviewStatus === 'archived' ? '恢复概念' : '归档概念'}
              </Button>
              <Button
                onPress={() => {
                  setTargetId('');
                  setAction('merge');
                }}
                isDisabled={state.pending}
              >
                合并到…
              </Button>
              <Button variant="danger" onPress={() => setAction('delete')} isDisabled={state.pending}>
                删除概念
              </Button>
              <Button variant="primary" onPress={() => setLinkOpen(true)} isDisabled={state.pending}>
                挂入知识点
              </Button>
            </div>
          ) : null}
          {selection.length && write ? (
            <div className={styles.toolbar}>
              <span>已选 {selection.length} 条</span>
              <Button onPress={() => setRemoval({ ids: selection, move: true })}>移到其他概念</Button>
              <Button variant="danger" onPress={() => setRemoval({ ids: selection, move: false })}>
                移出
              </Button>
            </div>
          ) : null}
          {groups.size ? (
            [...groups].map(([type, rows]) => (
              <section key={type} aria-label={knowledgeTypeLabel(type)}>
                <h2>{knowledgeTypeLabel(type)}</h2>
                <ul className={styles.list}>
                  {rows.map(link => (
                    <li key={link.id} className={styles.row}>
                      {write ? (
                        <Checkbox
                          aria-label={`选择${items.find(item => item.id === link.knowledgeItemId)?.title}`}
                          isSelected={selection.includes(link.id)}
                          onChange={checked =>
                            setSelection(ids => (checked ? [...ids, link.id] : ids.filter(id => id !== link.id)))
                          }
                        />
                      ) : null}
                      <Button variant="ghost" onPress={() => onOpenItem(link.knowledgeItemId)}>
                        {items.find(item => item.id === link.knowledgeItemId)?.title}
                      </Button>
                      <span>{link.role === 'subject' ? '主体' : '提及'}</span>
                      {write ? (
                        <>
                          <Button
                            variant="ghost"
                            isDisabled={state.pending}
                            onPress={() =>
                              void run({
                                ...base(concept),
                                type: 'setLinkRole',
                                linkIds: [link.id],
                                role: link.role === 'subject' ? 'mentions' : 'subject'
                              })
                            }
                          >
                            {link.role === 'subject' ? '改为提及' : '改为主体'}
                          </Button>
                          <Button variant="ghost" onPress={() => setRemoval({ ids: [link.id], move: true })}>
                            移动
                          </Button>
                          <Button variant="ghost" onPress={() => setRemoval({ ids: [link.id], move: false })}>
                            移出
                          </Button>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p>这个概念下还没有知识点。</p>
          )}
        </>
      ) : selectedId && state.status === 'ready' ? (
        <p>
          此概念已删除或合并。<Button onPress={() => onSelect(null)}>返回概念列表</Button>
        </p>
      ) : (
        <>
          <header className={styles.toolbar}>
            <h1>概念</h1>
            {write ? (
              <Button variant="primary" onPress={() => setEditor('new')}>
                新建概念
              </Button>
            ) : null}
          </header>
          <div className={styles.toolbar}>
            <SearchBox
              label="搜索概念"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="名称、别名或区分标签"
            />
            <Select
              label="概念筛选"
              presentation="toolbar"
              value={filter}
              onChange={key => setFilter(String(key))}
              options={[
                { id: 'active', label: '关注' },
                { id: 'muted', label: '不关注' },
                { id: 'archived', label: '已归档' }
              ]}
            />
          </div>
          <ul className={styles.list}>
            {candidates.map(row => {
              const count = conceptCounts(state, items, row.id);
              return (
                <li key={row.id}>
                  <PressableButton className={styles.conceptRow} onPress={() => onSelect(row.id)}>
                    <strong>{row.name}</strong>
                    <span>{row.sense}</span>
                    <span>
                      主体 {count.subject} · 提及 {count.mentions}
                    </span>
                    <span>
                      {row.reviewStatus === 'archived'
                        ? '已归档'
                        : row.reviewStatus === 'candidate'
                          ? '候选'
                          : row.focus === 'muted'
                            ? '不关注'
                            : '已确认'}
                    </span>
                  </PressableButton>
                </li>
              );
            })}
          </ul>
          {!candidates.length && state.status === 'ready' ? <p>暂无符合条件的概念。</p> : null}
        </>
      )}
      {editor ? (
        <ConceptEditor
          concept={editor === 'new' ? undefined : editor}
          canWrite={write}
          store={store}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {concept && linkOpen ? (
        <LinkItemsDialog
          concept={concept}
          items={items}
          canWrite={write}
          store={store}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}
      {concept && removal ? (
        <RemoveLinksDialog
          concept={concept}
          linkIds={removal.ids}
          move={removal.move}
          canWrite={write}
          store={store}
          onClose={() => {
            setRemoval(null);
            setSelection([]);
          }}
        />
      ) : null}
      {concept && action ? (
        <Dialog
          isOpen
          title={action === 'merge' ? '合并概念？' : '删除概念？'}
          isPending={state.pending}
          onOpenChange={open => {
            if (!open && !state.pending) setAction(null);
          }}
        >
          <DialogBody>
            <div className={styles.form}>
              {action === 'merge' ? (
                <>
                  <p>
                    将“{concept.name}
                    ”的知识点关联和关系迁到目标概念，并把原名称保留为别名。重复关联按主体优先去重，重复关系合为一条，概念内部的关系会删除。合并不可撤销。
                  </p>
                  <Select
                    label="合并目标"
                    value={targetId || null}
                    onChange={key => setTargetId(String(key ?? ''))}
                    options={state.concepts
                      .filter(row => !row.deletedAt && row.id !== concept.id && row.reviewStatus !== 'archived')
                      .map(row => ({ id: row.id, label: `${row.name}${row.sense ? ` · ${row.sense}` : ''}` }))}
                  />
                </>
              ) : (
                <p>
                  将删除“{concept.name}”、它的{' '}
                  {state.links.filter(row => !row.deletedAt && row.conceptId === concept.id).length} 条挂靠，以及{' '}
                  {
                    state.relations.filter(
                      row => !row.deletedAt && [row.fromConceptId, row.toConceptId].includes(concept.id)
                    ).length
                  }{' '}
                  条关系（边）。知识点正文保留。
                </p>
              )}
              {state.error ? <p role="alert">{state.error}</p> : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" isDisabled={state.pending} onPress={() => setAction(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              isPending={state.pending}
              isDisabled={!write || (action === 'merge' && !targetId)}
              onPress={() => void confirmAction()}
            >
              {action === 'merge' ? '确认合并' : '删除概念及关系'}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </section>
  );
}
