import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Button } from '../../components/ui/button/Button';
import { WorkspaceContextPanel } from './WorkspaceContextPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('repeated selection and Escape collapse context and restore the trigger focus', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const user = userEvent.setup();
  const selected = vi.fn();
  render(<WorkspaceContextPanel label="协作文档" current="当前文档">{close =>
    <Button onPress={() => { selected(); close(); }}>另一文档</Button>
  }</WorkspaceContextPanel>);
  const trigger = screen.getByRole('button', { name: /协作文档/ });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  const body = document.getElementById(trigger.getAttribute('aria-controls')!);
  expect(body).toHaveAttribute('data-collapsed', 'true');
  for (let index = 0; index < 2; index++) {
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: '另一文档' }));
    expect(trigger).toHaveFocus();
    expect(body).toHaveAttribute('data-collapsed', 'true');
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
  expect(selected).toHaveBeenCalledTimes(2);
});
it('resizing to narrow does not leave focus in newly hidden context', async () => {
  let listener = () => {};
  const media = { matches: false, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => media);
  const user = userEvent.setup();
  render(<WorkspaceContextPanel label="协作工作区">{() => <Button>工作区甲</Button>}</WorkspaceContextPanel>);
  await user.click(screen.getByRole('button', { name: '工作区甲' }));
  media.matches = true;
  listener();
  expect(screen.getByRole('button', { name: /协作工作区/ })).toHaveFocus();
  media.matches = false;
  listener();
  expect(screen.getByRole('button', { name: '工作区甲' })).toHaveFocus();
});
