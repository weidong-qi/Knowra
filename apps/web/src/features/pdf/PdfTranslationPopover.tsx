import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Popover, PopoverDialog } from '../../components/ui';
import { writeClipboardText } from '../../browser/clipboard';
import {
  MAX_TRANSLATION_CHARS,
  translateText,
  translationComment,
  type TranslationResult
} from '../translation/translationApi';
import type { PdfBarAnchor } from './PdfSelectionBar';
import styles from './PdfDictionaryPopover.module.css';

/** 不需要重试就能解决的错误：配置、外发、预算类问题，提示用户去设置处理。 */
const SETTINGS_CODES = new Set([
  'AI_NOT_CONFIGURED',
  'AI_EGRESS_NOT_READY',
  'AI_PRICE_UNAVAILABLE',
  'AI_GENERATION_UNAVAILABLE',
  'AI_DAILY_BUDGET_EXCEEDED',
  'AI_MONTHLY_BUDGET_EXCEEDED',
  'AI_PAUSED_BY_USER'
]);

export function PdfTranslationPopover({
  text,
  anchor,
  canSave,
  annotationControls,
  onSave,
  onClose,
  translate = translateText
}: {
  text: string;
  anchor: PdfBarAnchor;
  canSave: boolean;
  annotationControls?: ReactNode;
  onSave(comment: string): void;
  onClose(): void;
  translate?: typeof translateText;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const tooLong = text.length > MAX_TRANSLATION_CHARS;
  useEffect(() => {
    setResult(null);
    setError(null);
    setCopied(false);
    if (tooLong) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    void translate(text, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const code = (reason as { code?: string })?.code ?? '';
        setError({
          message: reason instanceof Error ? reason.message : '翻译失败，请重试。',
          retry: !SETTINGS_CODES.has(code)
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    // 关闭卡片或换选区时中止请求，服务端随之中止模型调用。
    return () => controller.abort();
  }, [text, attempt, tooLong, translate]);
  const comment = result ? translationComment(result) : '';
  const commentTooLong = comment.length > 2000;
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
        className={`${styles.popover} ${styles.wide}`}
        onOpenChange={open => {
          if (!open) onClose();
        }}
      >
        <PopoverDialog aria-label="PDF 翻译" className={styles.content}>
          <div className={styles.header}>
            <strong>{result?.targetLanguage === 'en' ? '翻译为英文' : '翻译'}</strong>
            <Button variant="ghost" size="mini" onPress={onClose}>
              关闭
            </Button>
          </div>
          {annotationControls}
          <div className={styles.meanings} aria-live="polite" aria-busy={busy}>
            {tooLong ? (
              <p role="alert">选区超过 {MAX_TRANSLATION_CHARS} 字，请分段选择后再翻译。</p>
            ) : busy ? (
              <p role="status">正在翻译…</p>
            ) : error ? (
              <p role="alert">{error.message}</p>
            ) : result ? (
              result.translation.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)
            ) : null}
          </div>
          {result?.truncated ? <p className={styles.muted}>译文可能不完整，请缩短选区后重试。</p> : null}
          {result && commentTooLong ? <p className={styles.muted}>译文较长，只能复制，无法保存为标注。</p> : null}
          {showSource ? <p className={`${styles.muted} ${styles.source}`}>{result?.sourceText ?? text}</p> : null}
          <div className={styles.footer}>
            <Button variant="ghost" size="mini" onPress={() => setShowSource(value => !value)}>
              {showSource ? '隐藏原文' : '查看原文'}
            </Button>
            <span className={styles.actions}>
              {error?.retry ? (
                <Button size="compact" onPress={() => setAttempt(value => value + 1)}>
                  重新翻译
                </Button>
              ) : null}
              {result ? (
                <>
                  <Button
                    size="compact"
                    onPress={() =>
                      void writeClipboardText(result.translation)
                        .then(setCopied)
                        .catch(() => setCopied(false))
                    }
                  >
                    {copied ? '已复制' : '复制译文'}
                  </Button>
                  <Button
                    variant="primary"
                    size="compact"
                    isDisabled={!canSave || commentTooLong}
                    onPress={() => onSave(comment)}
                  >
                    保存为标注
                  </Button>
                </>
              ) : null}
            </span>
          </div>
          <p className={styles.muted}>
            {result ? `${result.modelId} 机器翻译，仅供参考。` : '选中文字将发送至已配置的模型服务进行翻译。'}
            {!canSave && result ? ' 当前资料只读，仍可翻译。' : ''}
          </p>
        </PopoverDialog>
      </Popover>
    </>
  );
}
