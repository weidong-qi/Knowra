import { act, renderHook } from '@testing-library/react';
import { usePdfAnnotationInteraction } from './usePdfAnnotationInteraction';

it('单击 B 的操作栏不关闭 A 的输入框；重复单击仅切换操作栏', () => {
  const containerRef = { current: null };
  const { result } = renderHook(() => usePdfAnnotationInteraction('pdf-a', containerRef));
  act(() => result.current.openComment('a', false));
  act(() => result.current.toggleActions('b', { x: 100, y: 120 }));
  expect(result.current.selected).toBe('b');
  expect(result.current.commentEditor).toMatchObject({ id: 'a', focusRequest: 0 });
  expect(result.current.annotationAction?.id).toBe('b');
  act(() => result.current.toggleActions('b', { x: 101, y: 121 }));
  expect(result.current.annotationAction).toBeNull();
  expect(result.current.commentEditor?.id).toBe('a');
});

it('位置按标注在本次阅读内记忆，明确编辑请求聚焦，切换 PDF 清空', () => {
  const containerRef = { current: null };
  const { result, rerender } = renderHook(({ id }) => usePdfAnnotationInteraction(id, containerRef), {
    initialProps: { id: 'pdf-a' }
  });
  act(() => result.current.openComment('a', false));
  act(() => result.current.moveComment({ x: 180, y: 160 }));
  act(() => result.current.openComment('b', true));
  expect(result.current.commentEditor?.focusRequest).toBeGreaterThan(0);
  act(() => result.current.openComment('a', false));
  expect(result.current.commentEditor).toMatchObject({ id: 'a', x: 180, y: 160 });
  rerender({ id: 'pdf-b' });
  expect(result.current.commentEditor).toBeNull();
  act(() => result.current.openComment('a', false));
  expect(result.current.commentEditor).toMatchObject({ x: 24, y: 48 });
});
