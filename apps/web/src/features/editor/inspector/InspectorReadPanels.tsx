import type { CSSProperties, RefObject } from 'react';
import { MathText } from '../../../components/math/MathText';
import type { Tag } from '@study-accelerator/web-core';
import { Button } from '../../../components/ui';
import { NoteStatusControl } from './NoteStatusControl';
import { NoteIcon, TagIcon, LinkIcon, PaperclipIcon } from '../../../components/icons/knowra';
import { buildFolderPath, getSourceLabel, formatInspectorDay, formatInspectorMoment, type getDocumentStats, type InspectorHeading, type InspectorRelations } from '../editorInspectorModel';
import { EditorAttachmentPanel } from '../EditorAttachmentPanel';
import { TagChip } from '../../tags';
import type { EditorInspectorProps } from './types';
import { InspectorSection, Metadata, NoteLinks } from './InspectorSection';
import styles from '../EditorInspector.module.css';

export function InfoPanel(props: Pick<EditorInspectorProps, 'note' | 'folder' | 'foldersById' | 'canWrite' | 'onOpenTag' | 'onOpenNote' | 'attachments' | 'extendedWritesEnabled' | 'attachmentActions' | 'onOpenKnowledgeItem' | 'markdown' | 'canInsertAttachment' | 'attachmentsLoading' | 'onUploadAttachment' | 'onInsertAttachment' | 'onRenameAttachment' | 'onDeleteAttachment' | 'onOrganizeNote'> & {
  assignedTags: Tag[];
  relations: InspectorRelations;
  stats: ReturnType<typeof getDocumentStats>;
  tagTriggerRef?: RefObject<HTMLButtonElement | null>;
  onEditTags(): void;
  onOrganize(): void;
}) {
  const folderPath = buildFolderPath(props.folder, props.foldersById);
  return (
    <>
      <div className={styles.noteHeading}>
        <span>{getSourceLabel(props.note.sourceType)}</span>
        <h3>{props.note.title || '无标题笔记'}</h3>
      </div>
      <InspectorSection
        icon={<NoteIcon size={18} />}
        title="笔记信息"
        action={<Button size="mini" isDisabled={!props.canWrite} onPress={props.onOrganize}>整理</Button>}
      >
        <dl className={styles.metadata}>
          <Metadata label="状态" value={<NoteStatusControl key={props.note.id} status={props.note.status} disabled={!props.canWrite} onChange={status => props.onOrganizeNote({ folderId: props.note.folderId ?? null, status })} />} />
          <Metadata label="位置" value={folderPath} />
          <Metadata label="篇幅" value={<span className={styles.mono}>{props.stats.characterCount.toLocaleString('zh-CN')} 字 · {props.stats.readingMinutes > 0 ? `约 ${props.stats.readingMinutes} 分钟` : '少于 1 分钟'}</span>} />
          <Metadata label="时间" value={<span className={styles.mono} title={`创建于 ${formatInspectorMoment(props.note.createdAt)}`}>更新 {formatInspectorMoment(props.note.updatedAt)} · 创建 {formatInspectorDay(props.note.createdAt)}</span>} />
        </dl>
      </InspectorSection>
      <InspectorSection
        icon={<TagIcon size={18} />}
        title="标签"
        count={props.assignedTags.length || undefined}
        emptyHint={props.assignedTags.length === 0 ? '暂无' : undefined}
        action={<Button ref={props.tagTriggerRef} size="mini" isDisabled={!props.canWrite} onPress={props.onEditTags}>{props.assignedTags.length === 0 ? '添加' : '编辑'}</Button>}
      >
        <div className={styles.tags}>
          {props.assignedTags.length > 0
            ? props.assignedTags.map((tag) => <TagChip key={tag.id} tag={tag} onClick={props.onOpenTag ? () => props.onOpenTag?.(tag.id) : undefined} aria-label={`查看标签 ${tag.name}`} />)
            : <p className={styles.emptyInline}>暂无标签</p>}
        </div>
      </InspectorSection>
      <InspectorSection icon={<LinkIcon size={18} />} title="关联笔记" count={props.relations.related.length || undefined} emptyHint={props.relations.related.length === 0 ? '暂无' : undefined}>
        <NoteLinks notes={props.relations.related} onOpenNote={props.onOpenNote} empty="暂无关联笔记" />
      </InspectorSection>
      <InspectorSection icon={<PaperclipIcon size={18} />} title="附件" count={props.attachments.length}>
        {props.extendedWritesEnabled === false ? <p className={styles.emptyInline}>离线附件当前仅支持阅读已导入的文件。</p> : null}
        <EditorAttachmentPanel
          key={props.note.id}
          actions={props.attachmentActions}
          onOpenNote={props.onOpenNote}
          onOpenKnowledgeItem={props.onOpenKnowledgeItem}
          attachments={props.attachments}
          markdown={props.markdown}
          canWrite={props.canWrite && props.extendedWritesEnabled !== false}
          canInsert={props.canInsertAttachment}
          loading={props.attachmentsLoading}
          onUpload={props.onUploadAttachment}
          onInsert={props.onInsertAttachment}
          onRename={props.onRenameAttachment}
          onDelete={props.onDeleteAttachment}
        />
      </InspectorSection>
    </>
  );
}

export function OutlinePanel({ outline, onNavigate }: {
  outline: InspectorHeading[];
  onNavigate(heading: InspectorHeading, index: number): void;
}) {
  const depths = outlineDepths(outline);
  return (
    <section className={`${styles.simplePanel} ${styles.outlinePanel}`} aria-label="文档大纲">
      {outline.length > 0 ? <nav className={styles.outline} aria-label="文档大纲">
        {outline.map((heading, index) => (
          <button
            key={heading.id}
            type="button"
            data-level={heading.level}
            data-depth={depths[index]}
            style={{ '--outline-depth': depths[index] } as CSSProperties}
            aria-label={`跳转到「${heading.text}」，H${heading.level}`}
            onClick={() => onNavigate(heading, index)}
          >
            <span className={styles.outlineText}><MathText text={heading.text} inlineOnly /></span>
            <span className={styles.outlineLevel} aria-hidden="true">H{heading.level}</span>
          </button>
        ))}
      </nav> : <p className={styles.emptyPanel}>添加一至四级标题后，大纲会自动生成。</p>}
    </section>
  );
}

/** 按实际嵌套计算缩进：H1 下直接跟 H4 只缩一级，不按标题级别留空档。 */
function outlineDepths(outline: InspectorHeading[]) {
  const stack: number[] = [];
  return outline.map(({ level }) => {
    while (stack.length && stack[stack.length - 1] >= level) stack.pop();
    stack.push(level);
    return stack.length - 1;
  });
}

export function LinksPanel({ relations, loading, onOpenNote, noteLinks, linksLoading, error, onOpenOccurrence, onOpenLinkedNote }: {
  relations: InspectorRelations;
  loading: boolean;
  onOpenNote(noteId: string): void;
  noteLinks?: import('@study-accelerator/web-core').NoteLinkRelations;
  linksLoading?: boolean; error?: string;
  onOpenOccurrence?(sourceId: string, locator: import('@study-accelerator/content-anchor').NoteLinkLocator): void;
  onOpenLinkedNote?(id: string): void;
}) {
  if (noteLinks || error || linksLoading) return <div className={styles.linksPanel}>
    {linksLoading ? <p role="status">正在更新笔记引用…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <InspectorSection icon={<LinkIcon size={18} />} title="引用这篇笔记" count={noteLinks?.backlinks.length ?? 0}>
      {noteLinks?.backlinks.length ? noteLinks.backlinks.map(source => <div key={source.id} className={styles.noteLinkGroup}>
        <strong>{source.title}</strong>
        {!source.occurrences.length ? <Button variant="ghost" onPress={() => onOpenNote(source.id)}>旧链接，打开来源笔记</Button> : null}
        {source.occurrences.map(item => <Button key={`${item.occurrenceId}:${item.sourceStart}`} variant="ghost"
          onPress={() => onOpenOccurrence?.(source.id, { occurrenceId: item.occurrenceId, targetNoteId: item.targetNoteId })}>{item.context || item.label}</Button>)}
      </div>) : <p className={styles.emptyPanel}>暂无反向链接</p>}
    </InspectorSection>
    <InspectorSection icon={<NoteIcon size={18} />} title="本页链接" count={noteLinks?.outgoing.length ?? 0}>
      {noteLinks?.outgoing.length ? noteLinks.outgoing.map(target => <div key={target.id} className={styles.noteLinkGroup}>
        <Button variant="ghost" isDisabled={target.status === 'deleted'} onPress={() => (onOpenLinkedNote ?? onOpenNote)(target.id)}>
          {target.title}{target.status === 'deleted' && target.title !== '目标已删除' ? '（目标已删除）' : ''}
        </Button>
      </div>) : <p className={styles.emptyPanel}>暂无内部链接</p>}
    </InspectorSection>
  </div>;
  return (
    <div className={styles.linksPanel}>
      {loading ? <p className={styles.panelStatus} role="status">正在同步服务端链接…</p> : null}
      <InspectorSection icon={<LinkIcon size={18} />} title="引用这篇笔记" count={relations.backlinks.length}>
        <NoteLinks notes={relations.backlinks} onOpenNote={onOpenNote} empty="暂无反向链接" />
      </InspectorSection>
      <InspectorSection icon={<NoteIcon size={18} />} title="本页链接" count={relations.outgoing.length}>
        <NoteLinks notes={relations.outgoing} onOpenNote={onOpenNote} empty="暂无内部链接" />
      </InspectorSection>
    </div>
  );
}
