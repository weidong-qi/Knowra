import { useState } from 'react';
import { useAppStore } from '../../store/AppStoreProvider';
import { Button, Dialog, DialogBody } from '../../components/ui';
import { downloadTextFile } from '../../browser/downloadFile';
import type { RecoveredNoteDraft } from './noteDraftRecovery';
import { getNoteDraftScope } from './noteDraftScope';

/** 启动时列出跨重启草稿；即便原笔记已删除也保留导出入口。 */
export function RecoveryDraftNotice({ onOpenNote }: { onOpenNote(id: string): void }) {
  const notes = useAppStore(state => state.serverData.notes);
  const [dismissed, setDismissed] = useState(false);
  const [recovery] = useState(() => {
    try {
      return Object.entries(window.knowraDesktop?.readRecoveryDrafts?.() ?? {}).filter(([key]) => key.startsWith('knowra:note-draft:v1:')).map(([key, draft]) => {
        const [scope, noteId] = JSON.parse(key.slice('knowra:note-draft:v1:'.length));
        return { key, scope: String(scope), noteId: String(noteId), draft: draft as RecoveredNoteDraft };
      });
    } catch { return null; }
  });
  if (dismissed || recovery?.length === 0) return null;
  return <Dialog title="恢复草稿" isOpen={!dismissed} onOpenChange={open => setDismissed(!open)}><DialogBody>
    {recovery ? <>上次有 {recovery.length} 篇正文尚未保存，恢复草稿已保留。
      {recovery.map(({ key, scope, noteId, draft }) => {
        const note = notes.find(item => item.id === noteId);
        const title = note?.title ?? '未找到原笔记';
        const matchesDataset = Boolean(note && getNoteDraftScope(note.spaceId) === scope);
        return <span key={key}>
          {!matchesDataset ? <span>其他资料版本的草稿或原笔记已不存在，仅可导出。</span> : null}
          <Button variant="ghost" isDisabled={!note || note.deleted || !matchesDataset} onPress={() => { onOpenNote(noteId); setDismissed(true); }}>恢复：{title}</Button>
          <Button variant="ghost" onPress={() => downloadTextFile(`${title}-恢复草稿.md`, draft.markdown, 'text/markdown;charset=utf-8')}>导出草稿</Button>
        </span>;
      })}
    </> : '恢复草稿读取失败，请保留本机资料目录中的 recovery-drafts.json。'}
    <Button variant="ghost" onPress={() => setDismissed(true)}>收起提示</Button>
  </DialogBody></Dialog>;
}
