import { useLayoutEffect, useRef, useState } from 'react';
import type { SourceRef } from './conversationApi';

interface SourceVersion { content: string; contentHash: string }
interface SourcePreview { ref: SourceRef; text: string; messageId: string }
interface Options {
  spaceId: string | null;
  conversationId: string | null;
  getNoteVersion(noteId: string, versionId: string): Promise<SourceVersion>;
  onError(error: string | null): void;
}

/** 引用预览的读取、原文校验与发布权；关闭或离开会话会作废所有在途读取。 */
export function useConversationSourcePreview({ spaceId, conversationId, getNoteVersion, onError }: Options) {
  const [sourceView, setSourceView] = useState<SourcePreview | null>(null);
  const request = useRef(0);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    setSourceView(null);
    return () => { mounted.current = false; request.current++; };
  }, [spaceId, conversationId]);

  function closeSource() {
    request.current++;
    setSourceView(null);
  }

  async function openSource(ref: SourceRef, messageId: string) {
    const current = ++request.current;
    const isCurrent = () => mounted.current && request.current === current;
    onError(null);
    try {
      const version = await getNoteVersion(ref.noteId, ref.noteVersionId);
      if (!isCurrent()) return;
      if (version.contentHash !== ref.contentHash || ref.start < 0 || ref.end > version.content.length || ref.end <= ref.start) {
        throw new Error('历史原文与引用范围不一致。');
      }
      if (globalThis.crypto?.subtle) {
        const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
          .map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (await digest(version.content) !== ref.contentHash
          || await digest(version.content.slice(ref.start, ref.end)) !== ref.quoteHash) {
          throw new Error('引用原文校验失败。');
        }
      }
      if (isCurrent()) setSourceView({ ref, text: version.content, messageId });
    } catch (cause) {
      if (isCurrent()) onError(cause instanceof Error ? cause.message : '无法读取引用原文。');
    }
  }

  return { sourceView, openSource, closeSource };
}
