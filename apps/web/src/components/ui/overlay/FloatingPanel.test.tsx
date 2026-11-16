import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { TextAreaField } from '../input';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('普通显示保留焦点，明确编辑才聚焦；空白、滚动和组合输入不关闭', () => {
  const close = vi.fn();
  const props = {
    title: '批注',
    point: { x: 40, y: 40 },
    onPositionChange: () => {},
    onClose: close,
    'aria-label': '批注窗口'
  };
  const view = render(
    <>
      <input aria-label="原焦点" />
      <FloatingPanel {...props} focusRequest={0}>
        <TextAreaField label="批注内容" />
      </FloatingPanel>
    </>
  );
  const input = screen.getByRole('textbox', { name: '原焦点' });
  input.focus();
  fireEvent.pointerDown(document.body);
  fireEvent.scroll(window);
  expect(close).not.toHaveBeenCalled();
  expect(input).toHaveFocus();
  view.rerender(
    <>
      <input aria-label="原焦点" />
      <FloatingPanel {...props} focusRequest={1}>
        <TextAreaField label="批注内容" />
      </FloatingPanel>
    </>
  );
  const content = screen.getByRole('textbox', { name: '批注内容' });
  expect(content).toHaveFocus();
  fireEvent.keyDown(content, { key: 'Escape', isComposing: true });
  fireEvent.keyDown(content, { key: 'Escape', keyCode: 229 });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(content, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('标题栏拖动与键盘移动只改变窗口位置，取消拖动恢复起点', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  function Harness() {
    const [point, setPoint] = useState({ x: 40, y: 40 });
    return (
      <FloatingPanel title="批注" aria-label="批注窗口" point={point} onPositionChange={setPoint} onClose={() => {}}>
        <TextAreaField label="批注内容" />
      </FloatingPanel>
    );
  }
  render(<Harness />);
  const handle = screen.getByRole('group', { name: '移动批注窗口' }),
    header = handle.parentElement!,
    panel = screen.getByRole('dialog');
  fireEvent.pointerDown(header, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerMove(header, { clientX: 130, clientY: 90, pointerId: 1 });
  expect(panel).toHaveStyle({ left: '120px', top: '80px' });
  fireEvent.pointerCancel(header, { pointerId: 1 });
  expect(panel).toHaveStyle({ left: '40px', top: '40px' });
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(panel).toHaveStyle({ left: '50px' });
  fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
  expect(panel).toHaveStyle({ top: '41px' });
});
