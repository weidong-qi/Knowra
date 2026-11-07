import { afterEach, describe, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { remapCopiedKnowraMarks } from '../features/editor/editorKnowraClipboard';
import { KNOWRA_MARK } from '../features/editor/editorKnowraMarks';
import { randomId } from './randomId';
import { createBlockId } from '../features/editor/editorBlockIdentity';
import { createAiDraftCoordination } from '../features/editor/aiDraftCoordination';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe('局域网 HTTP 安全随机 ID', () => {
  it('优先使用浏览器原生 UUID', () => {
    const native = vi.fn(() => '12345678-1234-4123-8123-123456789abc');
    vi.stubGlobal('crypto', { randomUUID: native, getRandomValues: vi.fn() });
    expect(randomId()).toBe('12345678-1234-4123-8123-123456789abc');
    expect(native).toHaveBeenCalledOnce();
  });
  it('缺少 randomUUID 时仍使用安全随机源并设置 v4 与 variant 位', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(255);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    expect(randomId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(randomId()).toMatch(uuidV4);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
  });
  it('LAN 上的编辑器块 ID 与草稿协调 ID 不依赖 randomUUID', async () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    const ids = Array.from({ length: 20 }, () => createBlockId());
    expect(ids.every(id => /^b[0-9a-f]{15}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(20);
    const send = vi.fn(async () => undefined);
    const coordinator = createAiDraftCoordination({
      clientId: 'synthetic-tab',
      storage: localStorage,
      send,
      schedule: () => () => undefined
    });
    coordinator.register('synthetic-scope', 'synthetic-note', true);
    await coordinator.flush();
    expect(send).toHaveBeenCalledWith({
      clientId: expect.stringMatching(uuidV4),
      noteId: 'synthetic-note',
      dirty: true
    });
    coordinator.close();
  });
  it('LAN 上复制重点会生成独立的合法 ID', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const schema = new Schema({
      nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
      marks: { [KNOWRA_MARK]: { attrs: { id: {} } } }
    });
    const mark = schema.marks[KNOWRA_MARK].create({ id: 'original' });
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('原文', [mark])),
      schema.node('paragraph', null, schema.text('副本', [mark]))
    ]);
    const tr = EditorState.create({ schema, doc }).tr;
    expect(remapCopiedKnowraMarks(tr, [[4, 8]], false)).toBe(true);
    expect(tr.doc.child(0).firstChild!.marks[0].attrs.id).toBe('original');
    const copyId = tr.doc.child(1).firstChild!.marks[0].attrs.id;
    expect(copyId).toMatch(/^[0-9a-f]{8}$/);
    expect(copyId).not.toBe('original');
  });
  it('安全随机源也不可用时抛错，不降级到 Math.random', () => {
    vi.stubGlobal('crypto', {});
    expect(() => randomId()).toThrow();
  });
});
