import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PdfAnnotationTooltip } from './PdfAnnotationTooltip';

vi.mock('../../components/ui', async () => {
  const { forwardRef } = await import('react');
  return {
    TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Tooltip: forwardRef<
      HTMLDivElement,
      HTMLAttributes<HTMLDivElement> & {
        triggerRef?: unknown;
        placement?: string;
        offset?: number;
        containerPadding?: number;
      }
    >(
      (
        {
          children,
          triggerRef: _triggerRef,
          placement: _placement,
          offset: _offset,
          containerPadding: _containerPadding,
          ...props
        },
        ref
      ) =>
        children ? (
          <div {...props} ref={ref} role="tooltip">
            {children}
          </div>
        ) : null
    )
  };
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-test-page]').forEach(element => element.remove());
  Reflect.deleteProperty(document, 'elementFromPoint');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement('div');
  container.dataset.testPage = '';
  container.innerHTML = '<div class="page"><span>正文</span><svg><rect data-pdf-annotation-id="a1" /></svg></div>';
  document.body.append(container);
  const target = container.querySelector('span')!;
  vi.spyOn(container.querySelector('rect')!, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    right: 100,
    top: 10,
    bottom: 40
  } as DOMRect);
  const atPoint = vi.fn(() => target);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: atPoint });
  const item = { id: 'a1', kind: 'important', comment: '悬停批注' } as PdfAnnotation;
  const props = { containerRef: { current: container }, items: [item], enabled: true, revision: 1 };
  const view = render(<PdfAnnotationTooltip {...props} />);
  const move = (x = 30) => fireEvent(target, new MouseEvent('pointermove', { clientX: x, clientY: 20, bubbles: true }));
  move();
  return { container, target, item, props, view, atPoint, move };
}

it('文字层迟到的重绘保留仍命中的批注，位置失效时才收起', () => {
  const { item, props, view, atPoint } = setup();
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
  view.rerender(<PdfAnnotationTooltip {...props} items={[{ ...item }]} revision={2} />);
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
  atPoint.mockReturnValue(document.body);
  view.rerender(<PdfAnnotationTooltip {...props} revision={3} />);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('鼠标跨过间隙移入预览后，可以滚动和按压；离开预览后收起', () => {
  vi.useFakeTimers();
  const { container, move } = setup();
  const tooltip = screen.getByRole('tooltip');
  move(110);
  act(() => vi.advanceTimersByTime(150));
  expect(tooltip).toBeVisible();
  fireEvent.pointerLeave(container);
  fireEvent.pointerEnter(tooltip);
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.wheel(tooltip, { deltaY: 300 });
  fireEvent.scroll(tooltip);
  fireEvent.pointerDown(tooltip);
  expect(tooltip).toBeVisible();
  fireEvent.pointerLeave(tooltip);
  act(() => vi.advanceTimersByTime(300));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('返回标注会取消关闭，持续移过空白也会按时关闭', () => {
  vi.useFakeTimers();
  const { move } = setup();
  move(110);
  act(() => vi.advanceTimersByTime(150));
  move();
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole('tooltip')).toBeVisible();
  move(110);
  act(() => vi.advanceTimersByTime(200));
  move(120);
  act(() => vi.advanceTimersByTime(100));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('预览中遇到重绘仍保留；批注删除或禁用预览时关闭', () => {
  const { container, props, view, atPoint, move } = setup();
  fireEvent.pointerLeave(container);
  fireEvent.pointerEnter(screen.getByRole('tooltip'));
  atPoint.mockReturnValue(document.body);
  view.rerender(<PdfAnnotationTooltip {...props} revision={2} />);
  expect(screen.getByRole('tooltip')).toBeVisible();
  view.rerender(<PdfAnnotationTooltip {...props} items={[]} />);
  expect(screen.queryByRole('tooltip')).toBeNull();
  view.rerender(<PdfAnnotationTooltip {...props} />);
  move();
  expect(screen.getByRole('tooltip')).toBeVisible();
  view.rerender(<PdfAnnotationTooltip {...props} enabled={false} />);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it.each(['Escape', '滚动页面', '拖选正文', '点击外部'])('%s 立即关闭预览', action => {
  const { container } = setup();
  fireEvent.pointerLeave(container);
  fireEvent.pointerEnter(screen.getByRole('tooltip'));
  if (action === 'Escape') fireEvent.keyDown(document.body, { key: 'Escape' });
  if (action === '滚动页面') fireEvent.scroll(container);
  if (action === '拖选正文') fireEvent.pointerDown(container);
  if (action === '点击外部') fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('tooltip')).toBeNull();
});
