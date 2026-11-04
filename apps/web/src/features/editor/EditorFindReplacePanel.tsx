import { useEffect, useState, type FormEvent } from 'react';
import { Button, TextField } from '../../components/ui';
import type { EditorCommandTarget, EditorFindDirection, EditorFindMode, EditorFindResult } from './editorCommands';
import styles from './EditorFindReplacePanel.module.css';

export function EditorFindReplacePanel({
  mode,
  editor,
  onClose,
  onStatus
}: {
  mode: EditorFindMode | null;
  editor: EditorCommandTarget | null;
  onClose(): void;
  onStatus(message: string): void;
}) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [match, setMatch] = useState<EditorFindResult>({ found: false, count: 0, index: -1 });

  useEffect(() => {
    setMatch({ found: false, count: 0, index: -1 });
    if (!mode) editor?.clearFind();
  }, [editor, mode]);

  useEffect(() => {
    if (!mode) return;
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        editor?.clearFind();
        onClose();
        window.requestAnimationFrame(() => editor?.focus());
        return;
      }
      if (event.key !== 'F3' || !editor || !query.trim()) return;
      event.preventDefault();
      const result = editor.find(query, match.index, event.shiftKey ? 'previous' : 'next');
      setMatch(result);
      onStatus(result.found ? `已查找 ${result.index + 1}/${result.count}` : `未找到：${query.trim()}`);
    };
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [editor, match.index, mode, onClose, onStatus, query]);

  if (!mode) return null;
  const isReplace = mode === 'replace';
  const status = !query.trim()
    ? '输入内容后开始查找'
    : match.found
      ? `第 ${match.index + 1} / ${match.count} 处`
      : '未找到匹配项';

  const find = (direction: EditorFindDirection) => {
    if (!editor || !query.trim()) return;
    const result = editor.find(query, match.index, direction);
    setMatch(result);
    onStatus(result.found ? `已查找 ${result.index + 1}/${result.count}` : `未找到：${query.trim()}`);
  };
  const replaceCurrent = () => {
    if (!editor || !query.trim()) return;
    const result = editor.replaceCurrent(query, replacement, match.index);
    setMatch(result);
    onStatus(result.replaced ? `已替换 1 处，剩余 ${result.count} 处` : `未找到：${query.trim()}`);
  };
  const replaceAll = () => {
    if (!editor || !query.trim()) return;
    const result = editor.replaceAll(query, replacement);
    setMatch(result);
    onStatus(result.replaced ? `已全部替换 ${result.replaced} 处` : `未找到：${query.trim()}`);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isReplace) replaceCurrent();
    else find('next');
  };
  const close = () => {
    editor?.clearFind();
    onClose();
    window.requestAnimationFrame(() => editor?.focus());
  };
  return (
    <section
      className={styles.panel}
      aria-label={isReplace ? '替换面板' : '查找面板'}
      data-pdf-exclude="true"
    >
      <div className={styles.head}>
        <h2>{isReplace ? '查找与替换' : '查找'}</h2>
        <Button variant="ghost" onPress={close}>关闭</Button>
      </div>
      <form onSubmit={submit}>
        <div className={styles.fields} data-find-only={!isReplace || undefined}>
          <TextField
            autoFocus
            label="查找内容"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setMatch({ found: false, count: 0, index: -1 });
              editor?.clearFind();
            }}
            placeholder="输入要查找的文字"
          />
          {isReplace ? (
            <TextField label="替换为" value={replacement} onChange={setReplacement} placeholder="输入替换后的文字" />
          ) : null}
        </div>
        <div className={styles.statusRow}>
          <p className={styles.status} role="status" aria-live="polite">{status}</p>
          <div className={styles.actions}>
            {isReplace ? (
              <>
                <Button type="submit" isDisabled={!query.trim()}>替换一处</Button>
                <Button type="button" variant="primary" isDisabled={!query.trim()} onPress={replaceAll}>全部替换</Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" isDisabled={!query.trim()} onPress={() => find('previous')}>上一处</Button>
                <Button type="submit" variant="primary" isDisabled={!query.trim()}>下一处</Button>
              </>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
