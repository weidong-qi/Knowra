import { describe, expect, it } from 'vitest';
// @ts-expect-error 共享包是无类型声明的 JS；这里只校验常量与服务端一致。
import { DEFAULT_JSON_BODY_LIMIT_BYTES } from '../../../../../packages/shared/src/http-limits.js';
import type { AnnotationMapping } from '@study-accelerator/web-core';
import { IDENTITY_SNAPSHOT_MAX_BYTES, SAVE_REQUEST_LIMIT_BYTES, withIdentity } from './noteAutosaveSession';

const mapping: AnnotationMapping = { formatVersion: 1, operationId: 'op', baseContentHash: 'a', targetContentHash: 'b', edits: [] };
const snapshot = (blocks: number) => ({
  formatVersion: 2 as const, targetContentHash: 'h', annotations: [],
  blocks: Array.from({ length: blocks }, (_, index) => ({ id: `b${String(index).padStart(15, '0')}`, type: 'paragraph', empty: false }))
});
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe('身份快照随保存提交', () => {
  it('请求上限与服务端共享常量一致', () => {
    expect(SAVE_REQUEST_LIMIT_BYTES).toBe(DEFAULT_JSON_BODY_LIMIT_BYTES);
  });

  it('按最终 JSON 的 UTF-8 字节判断：反斜杠转义后逼近上限时省略快照', () => {
    // 原始字节约 3.9 MB，JSON 转义后约 7.8 MB；按原始字节估算会误判为安全。
    const markdown = '\\'.repeat(3_900_000);
    const editorState = snapshot(12_000);
    expect(bytes(editorState)).toBeGreaterThan(600_000);
    expect(bytes(editorState)).toBeLessThan(IDENTITY_SNAPSHOT_MAX_BYTES);
    const result = withIdentity(mapping, { markdown, build: () => editorState }, markdown, '2026-10-11T00:00:00.000Z');
    expect(result).toBe(mapping);
    const body = JSON.stringify({ rawMarkdown: markdown, annotationMapping: result, expectedUpdatedAt: '2026-10-11T00:00:00.000Z' });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(SAVE_REQUEST_LIMIT_BYTES);
  });

  it('正常大小时附带快照；正文不一致、快照过大或生成失败时省略', () => {
    const editorState = snapshot(10);
    expect(withIdentity(mapping, { markdown: '正文', build: () => editorState }, '正文')).toEqual({ ...mapping, editorState });
    expect(withIdentity(mapping, { markdown: '旧正文', build: () => editorState }, '正文')).toBe(mapping);
    expect(withIdentity(mapping, { markdown: '正文', build: () => snapshot(30_000) }, '正文')).toBe(mapping);
    expect(withIdentity(mapping, { markdown: '正文', build: () => { throw new Error('诊断失败'); } }, '正文')).toBe(mapping);
    expect(withIdentity(undefined, { markdown: '正文', build: () => editorState }, '正文')).toBeUndefined();
  });
});
