import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Button } from '../button/Button';
import { Dialog } from './Dialog';
import { ResponsivePanel } from './ResponsivePanel';

it('浮层关闭时跳过已隐藏且触发器已删除的父焦点范围', async () => {
  function Example() {
    const [panelOpen, setPanelOpen] = useState(true);
    const [triggerPresent, setTriggerPresent] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    return (
      <>
        <div hidden={!panelOpen}>
          <ResponsivePanel title="检查器" modal={false} isOpen={panelOpen} onClose={() => setPanelOpen(false)}>
            {triggerPresent ? <Button onPress={() => setDialogOpen(true)}>打开任务</Button> : <p>已完成</p>}
          </ResponsivePanel>
        </div>
        {dialogOpen ? (
          <Dialog isOpen title="任务">
            <button
              type="button"
              onClick={() => {
                setTriggerPresent(false);
                setPanelOpen(false);
                setDialogOpen(false);
              }}
            >
              完成任务
            </button>
          </Dialog>
        ) : null}
      </>
    );
  }
  render(<Example />);
  await userEvent.click(screen.getByRole('button', { name: '打开任务' }));
  const complete = screen.getByRole('button', { name: '完成任务' });
  complete.focus();
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(callback);
    return frames.length;
  });
  fireEvent.click(complete);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(document.body);
  // 焦点恢复在下一帧执行；只检查弹窗已关闭会漏掉上游的 null.dispatchEvent。
  expect(frames.length).toBeGreaterThan(0);
  act(() => frames.forEach(callback => callback(0)));
  expect(document.activeElement).toBe(document.body);
});
