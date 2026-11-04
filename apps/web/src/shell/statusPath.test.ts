import { describe, expect, it, vi } from 'vitest';
import { pathForSurface } from './path';
import { deriveStatusPath } from './statusPath';

describe('deriveStatusPath', () => {
  it('keeps the notes index surface stable despite latent store selections', () => {
    const path = deriveStatusPath({
      pathname: '/materials',
      routeDomain: 'materials',
      onNavigateHome: vi.fn(),
      onNavigateMaterials: vi.fn()
    });

    expect(path.map((segment) => segment.label)).toEqual(['笔记库', '全部笔记']);
    expect(path.at(-1)?.current).toBe(true);
    expect(path[0].onNavigate).toEqual(expect.any(Function));
    expect(path.some((segment) => segment.label.includes('M4-02'))).toBe(false);
  });

  it('projects the same canonical path for the compact notes header', () => {
    const path = deriveStatusPath({
      pathname: '/materials',
      routeDomain: 'materials',
      onNavigateHome: vi.fn(),
      onNavigateMaterials: vi.fn()
    });
    const topPath = pathForSurface(path, 'notes-index');

    expect(topPath.map((segment) => segment.id)).toEqual(['materials:root', 'materials:index']);
    expect(topPath.map((segment) => segment.label)).toEqual(['笔记库', '全部笔记']);
    expect(topPath[0]).toBe(path[0]);
    expect(topPath[1]).toBe(path[1]);
  });

  it('keeps the home surface as a single current segment', () => {
    const path = deriveStatusPath({
      pathname: '/',
      routeDomain: 'materials',
      onNavigateHome: vi.fn(),
      onNavigateMaterials: vi.fn()
    });

    expect(path).toEqual([{ id: 'home', label: '主页', current: true, onNavigate: expect.any(Function) }]);
  });

  it('uses the routed note title as the editor surface location', () => {
    const path = deriveStatusPath({
      pathname: '/materials/notes/note-1',
      routeDomain: 'materials',
      noteTitle: '注意力机制复盘',
      onNavigateHome: vi.fn(),
      onNavigateMaterials: vi.fn()
    });

    expect(path.map((segment) => segment.label)).toEqual(['笔记库', '注意力机制复盘']);
    expect(path.at(-1)?.current).toBe(true);
  });
});
