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
  const item = { id: 'a1', type: 'highlight', kind: 'important', comment: '悬停批注' } as PdfAnnotation;
  const props = { containerRef: { current: container }, items: [item], enabled: true, revision: 1 };
  const view = render(<PdfAnnotationTooltip {...props} />);
  const move = (x = 30) => fireEvent(target, new MouseEvent('pointermove', { clientX: x, clientY: 20, bubbles: true }));
  move();
  return { container, target, item, props, view, atPoint, move };
}

function addMark(container: HTMLElement, item: PdfAnnotation, left = 0, right = 200) {
  const mark = document.createElementNS('http://www.w3.org/2000/svg', item.type === 'note' ? 'g' : 'rect');
  mark.dataset.pdfAnnotationId = item.id;
  mark.dataset.type = item.type;
  vi.spyOn(mark, 'getBoundingClientRect').mockReturnValue({ left, right, top: 0, bottom: 100 } as DOMRect);
  container.querySelector('svg')!.append(mark);
}

it.each(['highlight', 'underline', 'region', 'note'] as const)('上层 %s 没有批注时，悬停和重绘均保留底层批注', type => {
  const { container, item, props, view, move } = setup();
  const cover = { ...item, id: 'cover', type, comment: ' \n\t ' };
  addMark(container, cover);
  view.rerender(<PdfAnnotationTooltip {...props} items={[item, cover]} revision={2} />);
  // 鼠标不移动时，也不能因重绘校验只命中上层而丢失底层预览。
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
  fireEvent.pointerDown(container);
  expect(screen.queryByRole('tooltip')).toBeNull();
  move();
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
});

it('一个空批注区域覆盖多条标注时，逐条预览指针下的内容，不借用邻近批注', () => {
  vi.useFakeTimers();
  const { container, item, props, view, move } = setup();
  const second = { ...item, id: 'second', kind: 'question', comment: '另一条批注' };
  const cover = { ...item, id: 'cover', type: 'region' as const, comment: '' };
  addMark(container, second, 110, 140);
  addMark(container, cover);
  view.rerender(<PdfAnnotationTooltip {...props} items={[item, second, cover]} />);
  move();
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
  move(120);
  expect(screen.getByRole('tooltip')).toHaveTextContent('另一条批注');
  expect(screen.getByRole('tooltip')).toHaveAttribute('data-kind', 'question');
  move(180);
  act(() => vi.advanceTimersByTime(300));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('多层都有批注时仍优先最上层，所有命中内容为空时关闭预览', () => {
  const { container, item, props, view, move } = setup();
  const cover = { ...item, id: 'cover', type: 'region' as const, comment: '上层批注' };
  addMark(container, cover);
  view.rerender(<PdfAnnotationTooltip {...props} items={[item, cover]} />);
  move();
  expect(screen.getByRole('tooltip')).toHaveTextContent('上层批注');
  view.rerender(
    <PdfAnnotationTooltip
      {...props}
      items={[
        { ...item, comment: '' },
        { ...cover, comment: '' }
      ]}
    />
  );
  move();
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('忽略已经不在当前数据中的覆盖节点，仍可预览有效的底层批注', () => {
  const { container, item, move } = setup();
  fireEvent.pointerDown(container);
  addMark(container, { ...item, id: 'stale' });
  move();
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
});

it('恢复草稿缺少批注字段时跳过该候选，当前批注字段缺失时安全关闭', () => {
  const { container, item, props, view, move } = setup();
  const draft = { ...item, id: 'draft' };
  Reflect.deleteProperty(draft, 'comment');
  addMark(container, draft);
  view.rerender(<PdfAnnotationTooltip {...props} items={[item, draft]} />);
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
  fireEvent.pointerDown(container);
  move();
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
  const partial = { ...item };
  Reflect.deleteProperty(partial, 'comment');
  view.rerender(<PdfAnnotationTooltip {...props} items={[partial, draft]} />);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

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
