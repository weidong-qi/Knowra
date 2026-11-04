import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PointMenu } from './PointMenu';

afterEach(() => vi.unstubAllGlobals());

describe('PointMenu coordinate boundary', () => {
  it.each([
    [-5, -5, 12, 12],
    [1279, -5, 1267, 12],
    [-5, 639, 12, 627],
    [1279, 639, 1267, 627],
    [320, 240, 320, 240]
  ])('keeps the one-pixel anchor inside viewport padding at (%s, %s)', (x, y, left, top) => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 640);
    const { container } = render(<PointMenu point={{ x, y }} onOpenChange={() => {}}>内容</PointMenu>);
    expect(container.querySelector('span')).toHaveStyle({ left: `${left}px`, top: `${top}px` });
  });

  it('uses the current viewport when opening at a new coordinate after resize', () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 800);
    const { container, rerender } = render(<PointMenu point={{ x: 1000, y: 700 }} onOpenChange={() => {}}>内容</PointMenu>);
    vi.stubGlobal('innerWidth', 640);
    vi.stubGlobal('innerHeight', 480);
    rerender(<PointMenu point={{ x: 1001, y: 701 }} onOpenChange={() => {}}>内容</PointMenu>);
    expect(container.querySelector('span')).toHaveStyle({ left: '627px', top: '467px' });
  });

  it('uses the visual viewport offset and size when opening', () => {
    const viewport = Object.assign(new EventTarget(), { width: 600, height: 400, offsetLeft: 40, offsetTop: 60 });
    vi.stubGlobal('visualViewport', viewport);
    const { container } = render(<PointMenu point={{ x: 20, y: 700 }} onOpenChange={() => {}}>内容</PointMenu>);
    expect(container.querySelector('span')).toHaveStyle({ left: '52px', top: '447px' });
  });
});
