import { Button, Dialog, DialogBody, DialogClose, DialogFooter, PointMenu } from '../../components/ui';
import { MarkdownImportDialog } from '../editor/MarkdownImportDialog';
import { CreateEntryChoices } from './CreateEntryMenu';
import { PermanentDeleteNoteDialog } from './PermanentDeleteNoteDialog';
import { BatchTagDialog } from './BatchTagDialog';
import type { NotesIndexController } from './useNotesIndexController';
import styles from './NotesIndexView.module.css';

export function NotesIndexDialogs({ c }: { c: NotesIndexController }) {
  return <>
    <MarkdownImportDialog isOpen={c.importOpen} folderName={c.indexPath.map(segment => segment.label).join(' / ')}
      onOpenChange={c.setImportOpen} onImport={async sources => { await c.store.importMarkdownNotes(c.navigation.selectedFolderId, sources); c.refresh(); }} />
    <PointMenu point={c.backgroundMenu} onOpenChange={open => { if (!open) c.setBackgroundMenu(null); }}>
      <CreateEntryChoices canWrite={c.canWrite && !c.isRecycleView} onCreate={mode => { c.setBackgroundMenu(null); c.treeOperations.openCreate(mode, c.navigation.selectedFolderId); }} />
    </PointMenu>
    {c.treeOperations.dialogs}
    <PermanentDeleteNoteDialog noteTitle={c.permanentDeleteTarget?.title ?? ''} isOpen={Boolean(c.permanentDeleteTarget)}
      onOpenChange={open => { if (!open) c.setPermanentDeleteTarget(null); }} onDelete={async () => {
        if (!c.permanentDeleteTarget || !c.canWrite || !c.supportsPermanentDelete) return;
        c.setRecyclePendingId(c.permanentDeleteTarget.id);
        try { await c.store.permanentlyDeleteNote(c.permanentDeleteTarget.id); c.refresh(); }
        finally { c.setRecyclePendingId(null); }
      }} />
    <BatchTagDialog isOpen={c.batchTagOpen} tags={c.serverData.tags} groups={c.serverData.tagGroups}
      notes={c.allItems.flatMap(item => item.kind === 'note' && c.selectedNoteIds.has(item.note.id) ? [item.note] : [])}
      count={c.selectedNoteIds.size} pending={c.batchPending} error={c.batchError} onOpenChange={c.setBatchTagOpen}
      onSave={async (add, remove) => { if (await c.runBatch(() => c.store.updateTagsForNotes([...c.selectedNoteIds], add, remove))) c.setBatchTagOpen(false); }} />
    <Dialog title="将选中笔记移入回收站？" description={`将移动 ${c.selectedNoteIds.size} 篇笔记，后续可在回收站恢复。`}
      isOpen={c.batchDeleteOpen} onOpenChange={c.setBatchDeleteOpen} isPending={c.batchPending}>
      <DialogBody><p className={styles.dialogHint}>文件夹和未选中的笔记不会受影响。</p>
        {c.batchError ? <p className={styles.batchError} role="alert">{c.batchError}</p> : null}</DialogBody>
      <DialogFooter><DialogClose variant="ghost">取消</DialogClose>
        <Button variant="danger" isPending={c.batchPending} onPress={() => void c.runBatch(() => c.store.deleteNotes([...c.selectedNoteIds])).then(ok => { if (ok) c.setBatchDeleteOpen(false); })}>移入回收站</Button>
      </DialogFooter>
    </Dialog>
  </>;
}
