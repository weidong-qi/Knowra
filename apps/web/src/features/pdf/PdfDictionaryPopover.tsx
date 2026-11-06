import { useEffect, useRef, useState } from 'react';
import { Button, Popover, PopoverDialog, Select } from '../../components/ui';
import { dictionaryComment, lookupDictionary, type DictionaryEntry } from '../dictionary/localDictionary';
import type { PdfBarAnchor } from './PdfSelectionBar';
import styles from './PdfDictionaryPopover.module.css';

export function PdfDictionaryPopover({
  text,
  anchor,
  canSave,
  onSave,
  onClose
}: {
  text: string;
  anchor: PdfBarAnchor;
  canSave: boolean;
  onSave(comment: string): void;
  onClose(): void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<DictionaryEntry | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [meaning, setMeaning] = useState('all');
  useEffect(() => {
    let active = true;
    setResult(null);
    setError('');
    setBusy(true);
    setMeaning('all');
    void lookupDictionary(text)
      .then(entry => {
        if (active) setResult(entry);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : '查词失败，请重试。');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [text, attempt]);
  const selectedMeaning = result
    ? meaning === 'all'
      ? result.meanings.join('\n')
      : (result.meanings[Number(meaning)] ?? '')
    : '';
  const comment = result ? dictionaryComment(result, selectedMeaning) : '';
  const tooLong = comment.length > 2000;
  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden="true"
        className={styles.anchor}
        style={{ left: anchor.x, top: anchor.bottom }}
      />
      <Popover
        triggerRef={anchorRef}
        isOpen
        isNonModal
        placement="bottom start"
        offset={8}
        containerPadding={12}
        className={styles.popover}
        onOpenChange={open => {
          if (!open) onClose();
        }}
      >
        <PopoverDialog aria-label="PDF 查词" className={styles.content}>
          <div className={styles.header}>
            <div>
              <strong>{result?.word ?? text}</strong>
              {result?.phonetic ? <p className={styles.muted}>/{result.phonetic}/</p> : null}
            </div>
            <Button variant="ghost" size="mini" onPress={onClose}>
              关闭
            </Button>
          </div>
          <div className={styles.meanings} aria-live="polite" aria-busy={busy}>
            {busy ? (
              <p role="status">正在查词…</p>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : result ? (
              <>
                {result.query !== result.word ? (
                  <p className={styles.muted}>
                    原文 {text} → 原形 {result.word}
                  </p>
                ) : null}
                {result.language === 'en' ? <p className={styles.muted}>此词仅收录英文释义</p> : null}
                {result.meanings.map((value, index) => (
                  <p key={index}>{value}</p>
                ))}
              </>
            ) : (
              <p>本地词典未收录“{text}”。可以尝试选中单词原形或更短的词组。</p>
            )}
          </div>
          {result && result.meanings.length > 1 ? (
            <Select
              label="保存的释义"
              selectedKey={meaning}
              onSelectionChange={key => setMeaning(String(key))}
              options={[
                { id: 'all', label: '全部释义' },
                ...result.meanings.map((value, index) => ({ id: String(index), label: value }))
              ]}
            />
          ) : null}
          {tooLong ? <p className={styles.muted}>释义较长，请选择其中一条保存。</p> : null}
          <div className={styles.footer}>
            <a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noreferrer">
              ECDICT · 离线词典
            </a>
            {error ? (
              <Button size="compact" onPress={() => setAttempt(value => value + 1)}>
                重新查询
              </Button>
            ) : result ? (
              <Button
                variant="primary"
                size="compact"
                isDisabled={!canSave || busy || tooLong || !selectedMeaning}
                onPress={() => onSave(comment)}
              >
                保存为标注
              </Button>
            ) : null}
          </div>
          {!canSave && result ? <p className={styles.muted}>当前资料只读，仍可查词。</p> : null}
        </PopoverDialog>
      </Popover>
    </>
  );
}
