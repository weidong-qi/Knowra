/** 与服务端 `MAX_TRANSLATION_CHARS` 一致：超出时在前端直接提示分段，不发送请求。 */
export const MAX_TRANSLATION_CHARS = 3000;

export interface TranslationResult {
  translation: string;
  sourceText: string;
  targetLanguage: 'zh' | 'en';
  modelId: string;
  truncated: boolean;
}

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

/** 选中文字只在用户点击“翻译”后发送；中止 signal 时服务端同时中止模型请求。 */
export async function translateText(text: string, signal?: AbortSignal): Promise<TranslationResult> {
  let response: Response;
  try {
    response = await fetch('/api/ai/translate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Knowra-AI-Translate': '1' },
      body: JSON.stringify({ text }),
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TranslationError('无法连接翻译服务，请检查网络后重试。', 'NETWORK_ERROR');
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: TranslationResult;
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok || !payload?.data)
    throw new TranslationError(
      payload?.error?.message ?? '翻译失败，请重试。',
      payload?.error?.code ?? 'TRANSLATION_FAILED'
    );
  return payload.data;
}

/** 与查词一致：把本次看到的译文冻结进普通批注，注明来源模型。 */
export function translationComment(result: Pick<TranslationResult, 'translation' | 'modelId'>) {
  return [`翻译 · ${result.modelId}`, result.translation].join('\n');
}
