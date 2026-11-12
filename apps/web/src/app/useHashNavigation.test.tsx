import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHashNavigation } from './useHashNavigation';
import { registerNavigationGuard } from './navigationGuard';
import { useLayoutEffect, type ReactNode } from 'react';

describe('workspace browser history', () => {
  it('reads a location change between the first render and event subscription', () => {
    window.history.replaceState(null, '', '#/');
    const Wrapper = ({ children }: { children: ReactNode }) => {
      useLayoutEffect(() => {
        window.history.replaceState(null, '', '#/materials?scope=trash');
      }, []);
      return children;
    };
    const { result } = renderHook(() => useHashNavigation(), { wrapper: Wrapper });
    expect(result.current.pathname).toBe('/materials?scope=trash');
  });
  it('keeps an unsaved explicit form mounted until its navigation guard is released', async () => {
    window.history.replaceState(null, '', '#/knowledge');
    const { result } = renderHook(() => useHashNavigation());
    const release = registerNavigationGuard(() => false);
    try {
      act(() => result.current.navigate('/materials'));
      expect(result.current.pathname).toBe('/knowledge');
      act(() => {
        window.location.hash = '#/materials';
      });
      await waitFor(() => expect(window.location.hash).toBe('#/knowledge'));
      expect(result.current.pathname).toBe('/knowledge');
    } finally {
      release();
    }
    act(() => result.current.navigate('/materials'));
    expect(result.current.pathname).toBe('/materials');
  });
  it('replaces search edits without adding history entries and preserves forward navigation', async () => {
    window.history.replaceState(null, '', '#/knowledge');
    const { result } = renderHook(() => useHashNavigation());
    act(() => result.current.navigate('/knowledge?scope=candidate'));
    act(() => result.current.navigate('/knowledge?scope=candidate&q=卷积', { replace: true }));
    act(() => result.current.navigate('/knowledge/concepts?concept=cnn'));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.pathname).toBe('/knowledge?scope=candidate&q=卷积'));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.pathname).toBe('/knowledge'));
  });
  it('restores folder addresses and truncates forward history after a new branch', async () => {
    window.history.replaceState(null, '', '#/materials');
    const { result } = renderHook(() => useHashNavigation());
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.navigate('/materials?folder=parent'));
    act(() => result.current.navigate('/materials?folder=child'));
    expect(result.current.canGoBack).toBe(true);
    act(() => result.current.back());
    await waitFor(() => expect(result.current.pathname).toBe('/materials?folder=parent'));
    expect(result.current.canGoForward).toBe(true);
    act(() => result.current.forward());
    await waitFor(() => expect(result.current.pathname).toBe('/materials?folder=child'));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.pathname).toBe('/materials?folder=parent'));
    act(() => result.current.navigate('/materials?scope=favorites'));
    expect(result.current.canGoForward).toBe(false);
  });
});
