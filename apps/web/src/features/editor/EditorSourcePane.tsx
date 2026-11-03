import { Button } from '../../components/ui';
import styles from './EditorSourcePane.module.css';

export function EditorSourcePane({ markdown, readOnly, onChange, onSave }: {
  markdown: string;
  readOnly: boolean;
  onChange(markdown: string): void;
  onSave(): void;
}) {
  return (
    <section className={styles.pane} aria-label="Markdown 源码编辑器面板" data-pdf-exclude="true">
      <header className={styles.head}>
        <strong>Markdown 源码</strong>
        <Button variant="ghost" isDisabled={readOnly} onPress={onSave}>保存源码</Button>
      </header>
      <textarea
        className={styles.source}
        aria-label="Markdown 源码编辑器"
        name="markdown-source"
        autoComplete="off"
        value={markdown}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </section>
  );
}
