import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PdfAnnotationTooltip } from './PdfAnnotationTooltip';

vi.mock('../../components/ui', () => ({
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => (children ? <div role="tooltip">{children}</div> : null)
}));

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-test-page]').forEach(element => element.remove());
  Reflect.deleteProperty(document, 'elementFromPoint');
  vi.restoreAllMocks();
});

it('文字层迟到的重绘保留仍命中的批注，位置失效时才收起', () => {
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
  fireEvent(target, new MouseEvent('pointermove', { clientX: 30, clientY: 20, bubbles: true }));
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
  view.rerender(<PdfAnnotationTooltip {...props} items={[{ ...item }]} revision={2} />);
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停批注');
  atPoint.mockReturnValue(document.body);
  view.rerender(<PdfAnnotationTooltip {...props} revision={3} />);
  expect(screen.queryByRole('tooltip')).toBeNull();
});
