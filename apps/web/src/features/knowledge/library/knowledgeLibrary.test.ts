import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeItem } from '@study-accelerator/web-core';
import { createKnowledgeLibraryCache } from './knowledgeLibraryCache';
import {
  knowledgeLibraryNavigationKey,
  knowledgeLibraryPath,
  parseKnowledgeLibraryRoute
} from './knowledgeLibraryRoute';
const item = { id: 'k', title: '当前知识' } as KnowledgeItem;
describe('知识库导航与共享数据', () => {
  it('保留旧深链接和中文搜索，序列化后可恢复范围与选择', () => {
    const route = parseKnowledgeLibraryRoute('/knowledge/concepts?scope=muted&q=卷积&concept=a');
    expect(parseKnowledgeLibraryRoute(knowledgeLibraryPath(route))).toEqual(route);
    expect(parseKnowledgeLibraryRoute('/knowledge?item=k')).toEqual({
      page: 'items',
      scope: 'all',
      query: '',
      id: 'k'
    });
    expect(parseKnowledgeLibraryRoute('/knowledge?scope=unknown').scope).toBe('all');
  });
  it('连续搜索和选择条目保持工作区焦点，切换范围仍产生导航边界', () => {
    expect(knowledgeLibraryNavigationKey('/knowledge?scope=candidate&q=卷积&item=k')).toBe(
      '/knowledge?scope=candidate'
    );
    expect(knowledgeLibraryNavigationKey('/knowledge/concepts?concept=a&q=CNN')).toBe('/knowledge/concepts');
    expect(knowledgeLibraryNavigationKey('/materials?scope=trash')).toBe('/materials?scope=trash');
  });
  it('侧栏和页面并发读取共用一次请求，失败允许重试', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('连接失败')).mockResolvedValue([item]);
    const cache = createKnowledgeLibraryCache(loader);
    const first = cache.list();
    expect(cache.list()).toBe(first);
    await expect(first).rejects.toThrow('连接失败');
    expect(cache.getState()).toMatchObject({ status: 'error', error: '连接失败' });
    await cache.list();
    await cache.list();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.getState().items).toEqual([item]);
  });
  it('迟到的旧列表不能覆盖已保存的记录或永久删除结果', async () => {
    let finish!: (items: KnowledgeItem[]) => void;
    const loader = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<KnowledgeItem[]>(resolve => {
            finish = resolve;
          })
      )
      .mockResolvedValue([item]);
    const cache = createKnowledgeLibraryCache(loader);
    const loading = cache.list();
    cache.accept(item);
    finish([{ ...item, title: '旧内容' }]);
    await loading;
    expect(cache.getState().items).toEqual([item]);
    cache.remove(item.id);
    expect(cache.getState().items).toEqual([]);
  });
});
