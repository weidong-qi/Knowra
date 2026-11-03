import { Button, IconButton } from '../../components/ui';
import { MathText } from '../../components/math/MathText';
import { CloseIcon, FolderIcon, NoteIcon, PanelIcon } from '../../components/icons/knowra';
import { folderLocation, displayNoteStatus } from './notesIndexNavigation';
import { formatUpdatedAt, countFolderNotes } from './notesIndexModel';
import type { NotesIndexController } from './useNotesIndexController';
import styles from './NotesIndexView.module.css';

/** 只读索引元数据预览；完整正文和权限继续交给既有编辑页。 */
export function NotesIndexPreview({ c }: { c: NotesIndexController }) {
  const item = c.peekItem;
  const title = item?.kind === 'note' ? item.note.title || '未命名笔记' : item?.folder.name;
  const summary = item?.kind === 'folder' ? `${countFolderNotes(item.folder, c.serverData.notes)} 篇已加载笔记（含子目录）`
    : item && typeof item.note.summary === 'string' && item.note.summary ? <MathText text={item.note.summary} inlineOnly /> : '暂无摘要，打开笔记查看完整内容。';
  return <aside className={styles.peek} aria-label="笔记预览">
    <header className={styles.peekHeader}><h2>预览</h2>
      <IconButton aria-label="关闭预览栏" onPress={() => c.setPeekOpen(false)}><CloseIcon size={18} /></IconButton></header>
    {item ? <div className={styles.peekBody}>
      <div className={styles.peekHeading}>
        <span>{item.kind === 'folder' ? <FolderIcon size={13} /> : <NoteIcon size={13} />}{folderLocation(item.kind === 'folder' ? item.folder.parentId : item.note.folderId, c.serverData.foldersById)}</span>
        <h3>{title}</h3>
      </div>
      <section className={styles.peekSection}>
        <h3>信息</h3>
        <dl className={styles.previewDetails}>
          <dt>类型</dt><dd>{item.kind === 'folder' ? '文件夹' : '笔记'}</dd>
          <dt>最近更新</dt><dd>{formatUpdatedAt(item.kind === 'folder' ? item.folder.updatedAt : item.note.updatedAt)}</dd>
          {item.kind === 'note' ? <><dt>状态</dt><dd>{displayNoteStatus(item.note.status)}</dd>
            <dt>标签</dt><dd>{item.note.tagIds.map(id => c.serverData.tags.find(tag => tag.id === id)?.name).filter(Boolean).join(' · ') || '无标签'}</dd></> : null}
        </dl>
      </section>
      <section className={styles.peekSection}>
        <h3>{item.kind === 'folder' ? '目录内容' : '摘要'}</h3>
        <p className={styles.peekSummary}>{summary}</p>
      </section>
      <section className={styles.peekSection}>
        {item.kind === 'note' && item.note.deleted ? <p className={styles.optionHint}>笔记已在回收站，请先恢复。</p> : <Button size="compact" variant="primary"
          onPress={() => item.kind === 'folder' ? c.selectFolder(item.folder.id) : c.openNote(item.note.id)}>打开{item.kind === 'folder' ? '文件夹' : '笔记'}</Button>}
      </section>
    </div> : <div className={styles.peekEmpty}><PanelIcon size={26} /><strong>选择一项以预览</strong><p>开启预览后，单击笔记或目录查看信息，使用“打开”继续。</p></div>}
  </aside>;
}
