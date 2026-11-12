import { createAppError } from '../../../errors/app-error.ts';

const INLINE_MARKDOWN_IMAGE_PATTERN =
  /!\[[^\]]*]\(\s*<?(http:\/\/[^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi;
const HTML_IMAGE_PATTERN = /<img\b[^>]*\bsrc\s*=\s*(?:"(http:\/\/[^"]+)"|'(http:\/\/[^']+)'|(http:\/\/[^\s>]+))/gi;
const REFERENCE_IMAGE_PATTERN = /!\[[^\]]*]\[([^\]]+)]/gi;
const REFERENCE_DEFINITION_PATTERN = /^\s*\[([^\]]+)]:\s*<?(http:\/\/[^\s>]+)>?(?:\s+.*)?$/gim;

// 保留动态 exec、add/push 与迭代器的原始结果，不把捕获值提升为已验证字符串。
export function findInsecureImageUrls(markdown: unknown): unknown[] {
  const source = typeof markdown === 'string' ? markdown : '';
  const urls: unknown[] = [];
  const imageReferenceIds = new Set<unknown>();

  collectMatches(source, INLINE_MARKDOWN_IMAGE_PATTERN, match => match[1], urls);
  collectMatches(source, HTML_IMAGE_PATTERN, match => match[1] ?? match[2] ?? match[3], urls);
  collectMatches(source, REFERENCE_IMAGE_PATTERN, match => match[1], imageReferenceIds, normalizeReferenceId);
  collectMatches(
    source,
    REFERENCE_DEFINITION_PATTERN,
    match => {
      const referenceId = normalizeReferenceId(match[1]);
      return imageReferenceIds.has(referenceId) ? match[2] : null;
    },
    urls
  );

  return [...new Set(urls)];
}

export function assertNoInsecureImageUrls(markdown: unknown): void {
  const insecureUrls = findInsecureImageUrls(markdown);
  if (insecureUrls.length === 0) {
    return;
  }

  throw createAppError(
    'INSECURE_IMAGE_URL',
    '检测到不安全的 HTTP 图片地址。请先下载图片，再通过粘贴或上传保存为 Knowra 本地附件。',
    422
  );
}

interface MatchTarget {
  add?: (value: unknown) => unknown;
  push?: (value: unknown) => unknown;
}

function collectMatches(
  source: string,
  pattern: RegExp,
  selectValue: (match: RegExpExecArray) => unknown,
  target: MatchTarget,
  normalize: (value: unknown) => unknown = value => value
) {
  pattern.lastIndex = 0;
  let match = pattern.exec(source);
  while (match) {
    const value = selectValue(match);
    if (value) {
      // 不补齐缺失方法；动态 add 返回 nullish 时仍调用原 push 并保留原生异常。
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- 保留原短路表达式，避免改变两次规范化与调用顺序。
      target.add?.(normalize(value)) ?? target.push!(normalize(value));
    }
    match = pattern.exec(source);
  }
}

function normalizeReferenceId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
