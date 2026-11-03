import { useState } from 'react';
import { Button, Select, TextAreaField } from '../../components/ui';
import { TextDiff } from '../../components/ui/TextDiff';
import { entityFields, entityNames, entityPresence, entityTitle, fieldLabel, fieldValue, includesTrainingAssets, localAssetResolutionBlock, sameField, type Conflict, type EntityConflict, type EntityConflictItem } from './syncConflictModel';
import styles from './SyncConflictCards.module.css';

type Resolve = (choice: string, markdown?: string) => Promise<void>;

function MarkdownComparison({ base, local, remote }: { base: string | undefined; local: string | undefined; remote: string | undefined }) {
  const [mode, setMode] = useState('sides');
  const before = mode === 'sides' ? local ?? '' : base ?? '';
  const after = mode === 'local' ? local ?? '' : remote ?? '';
  return <div className={styles.comparison}>
    <Select label="正文比较" selectedKey={mode} onSelectionChange={key => setMode(String(key))} options={[
      { id: 'sides', label: '本机与云端' },
      { id: 'local', label: '共同基线 → 本机', isDisabled: base === undefined },
      { id: 'remote', label: '共同基线 → 云端', isDisabled: base === undefined }
    ]} />
    {base === undefined && <p className={styles.hint}>没有共同基线，无法判断各自从哪个版本开始修改。</p>}
    <TextDiff before={before} after={after} beforeLabel={mode === 'sides' ? '本机' : '共同基线'} afterLabel={mode === 'local' ? '本机' : '云端'} />
  </div>;
}

function ResolutionActions({ disabled, allowMerge, onResolve, initialMarkdown, localBlocked = false }: { disabled: boolean; allowMerge: boolean; onResolve: Resolve; initialMarkdown: string; localBlocked?: boolean }) {
  const [manual, setManual] = useState(false);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  return <>
    <div className={styles.actions}>
      <Button isDisabled={disabled} onPress={() => { void onResolve('remote'); }}>采用云端</Button>
      <Button isDisabled={disabled || localBlocked} onPress={() => { void onResolve('local'); }}>采用本地</Button>
      {allowMerge && <><Button isDisabled={disabled} onPress={() => { void onResolve('copy'); }}>保留为两篇</Button><Button isDisabled={disabled} onPress={() => setManual(!manual)}>手动合并</Button></>}
    </div>
    {manual && <div className={styles.merge}><TextAreaField label="合并后的正文" value={markdown} onChange={setMarkdown} rows={10} isDisabled={disabled} /><Button isDisabled={disabled} onPress={() => { void onResolve('manual', markdown); }}>保存合并结果</Button></div>}
  </>;
}

export function ConflictCard({ conflict, onResolve, disabled }: { conflict: Conflict; disabled: boolean; onResolve: Resolve }) {
  const title = conflict.local?.title ?? conflict.remote?.title ?? conflict.base?.title ?? '已删除笔记';
  const item = { ...conflict, collection: 'notes', id: conflict.noteId };
  return <section className={styles.conflict} aria-label={`冲突：${title}`}>
    <h3>{title} · {conflict.kind === 'delete' ? '删除与修改冲突' : '双方都有修改'}</h3>
    <EntityComparison item={item} items={[item]} />
    <p className={styles.hint}>处理前自动保留恢复记录。其他笔记可继续同步。</p>
    <ResolutionActions disabled={disabled} allowMerge onResolve={onResolve} initialMarkdown={conflict.local?.rawMarkdown ?? ''} />
  </section>;
}

function EntityComparison({ item, items }: { item: EntityConflictItem; items: EntityConflictItem[] }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const fields = entityFields(item);
  const changedFields = fields.filter(key => !sameField(item.local?.[key], item.remote?.[key]) || !sameField(item.base?.[key], item.local?.[key]));
  const shown = showUnchanged ? fields : changedFields;
  const hasMarkdown = [item.base, item.local, item.remote].some(value => typeof value?.rawMarkdown === 'string');
  return <div className={styles.comparison}>
    <div className={styles.tableWrap} tabIndex={0} aria-label="关联资料字段对比">
      <table className={styles.fields}>
        <thead><tr><th scope="col">字段</th><th scope="col">共同基线</th><th scope="col">本机</th><th scope="col">云端</th></tr></thead>
        <tbody>
          <tr><th scope="row">对象状态</th>{(['base', 'local', 'remote'] as const).map(side => <td key={side} className={side !== 'base' && entityPresence(item[side], item.base, false, item.collection) !== entityPresence(item.base, item.base, false, item.collection) ? styles.changed : ''}>{entityPresence(item[side], item.base, side === 'base', item.collection)}</td>)}</tr>
          {shown.slice(0, 80).map(key => <tr key={key}><th scope="row">{fieldLabel(key)}</th>{(['base', 'local', 'remote'] as const).map(side => {
            const changed = side !== 'base' && !sameField(item[side]?.[key], item.base?.[key]);
            return <td key={side} className={changed ? styles.changed : ''}>{changed && <span className={styles.changeLabel}>已变化</span>}{item[side] === null ? '—（对象不存在）' : fieldValue(item[side]?.[key], key, items, 0, item.collection, item[side]?.sourceType)}</td>;
          })}</tr>)}
        </tbody>
      </table>
    </div>
    {shown.length > 80 && <p className={styles.hint}>字段较多，仅展示前 80 项；完整内容可导出冲突恢复记录查看。</p>}
    <p className={styles.hint}>着色字段表示相对共同基线发生变化。{changedFields.length === 0 ? '未发现其他字段变化。' : ''}</p>
    {fields.length > changedFields.length && <Button onPress={() => setShowUnchanged(value => !value)}>{showUnchanged ? '隐藏未变字段' : `查看 ${fields.length - changedFields.length} 个未变字段`}</Button>}
    {hasMarkdown && <MarkdownComparison base={item.base?.rawMarkdown} local={item.local?.rawMarkdown} remote={item.remote?.rawMarkdown} />}
  </div>;
}

function EntityDetails({ item, items, initiallyOpen, isConflict }: { item: EntityConflictItem; items: EntityConflictItem[]; initiallyOpen: boolean; isConflict: boolean }) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  return <details className={styles.entity} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{entityNames[item.collection] ?? '资料'}：{entityTitle(item)}{isConflict ? ' · 存在冲突' : ' · 关联修改'}</summary>
    {expanded && <EntityComparison item={item} items={items} />}
  </details>;
}

export function EntityConflictCard({ conflict, disabled, onResolve }: { conflict: EntityConflict; disabled: boolean; onResolve: Resolve }) {
  const notes = conflict.items.filter(item => item.collection === 'notes' && item.local);
  const [visibleCount, setVisibleCount] = useState(20);
  const knowledge = conflict.items.filter(item => item.collection === 'knowledgeItems');
  const includesKnowledge = conflict.items.some(item => item.collection === 'knowledgeItems' || item.collection === 'knowledgeEvidence');
  const allowMerge = notes.length === 1 && !includesKnowledge && !includesTrainingAssets(conflict.items);
  const localBlock = localAssetResolutionBlock(conflict);
  const title = knowledge.length === 1 ? entityTitle(knowledge[0]) : notes.length === 1 ? entityTitle(notes[0]) : '关联资料';
  return <section className={styles.conflict} aria-label={`冲突：${title}`}>
    <h3>{title} · 关联资料需要核对</h3>
    <p>以下 {conflict.items.length} 项本机修改属于同一组关联资料。处理前会保存完整恢复记录；确认期间暂缓这组资料上传，其他笔记可继续同步。</p>
    <p className={styles.hint}>采用本地或云端会处理这一整组资料。{allowMerge ? '保留两篇会另建本地正文副本；手动合并只编辑正文，其他关联资料沿用本地。' : '请核对来源与审核状态后再选择；未采用的内容仍保留在恢复记录中。'}</p>
    {conflict.changedEpoch && <p className={styles.notice}>云端资料库已恢复或重建，请仔细核对。已删除对象不会自动恢复。</p>}
    {conflict.reasons.some(reason => reason.message) && <ul className={styles.reasons}>{conflict.reasons.filter(reason => reason.message).slice(0, 20).map((reason, index) => <li key={index}>{entityNames[reason.collection] ?? '资料'}：{reason.message}</li>)}</ul>}
    {conflict.items.slice(0, visibleCount).map((item, index) => <EntityDetails key={`${item.collection}:${item.id}`} item={item} items={conflict.items} initiallyOpen={index === 0} isConflict={conflict.reasons.some(reason => reason.collection === item.collection && reason.id === item.id)} />)}
    {visibleCount < conflict.items.length && <Button onPress={() => setVisibleCount(count => count + 20)}>继续查看关联资料（剩余 {conflict.items.length - visibleCount} 项）</Button>}
    {localBlock && <p className={styles.notice}>{localBlock}</p>}
    <ResolutionActions disabled={disabled} localBlocked={Boolean(localBlock)} allowMerge={allowMerge} onResolve={onResolve} initialMarkdown={notes[0]?.local?.rawMarkdown ?? ''} />
  </section>;
}
