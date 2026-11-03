import type { EditorView } from '@milkdown/kit/prose/view';
import { afterEach, expect, it } from 'vitest';
import { scrollEditorSelectionIntoView } from './editorSelectionScroll';

afterEach(() => document.body.replaceChildren());

function fixture(stackTop = 100) {
  const stage = document.createElement('div'); stage.dataset.editorScrollRoot = '';
  const stack = document.createElement('div'); stack.dataset.editorToolbarStack = '';
  const format = document.createElement('div'); format.setAttribute('role', 'toolbar'); format.setAttribute('aria-label', '笔记格式工具栏');
  const editor = document.createElement('div');
  stack.append(format); stage.append(stack, editor); document.body.append(stage);
  stage.getBoundingClientRect = () => ({ top: 100, bottom: 600 } as DOMRect);
  stack.getBoundingClientRect = () => ({ top: stackTop, bottom: stackTop + 110, height: 110 } as DOMRect);
  format.getBoundingClientRect = () => ({ top: stackTop, bottom: stackTop + 52, height: 52 } as DOMRect);
  stage.scrollTop = 500;
  const caret = { top: 180, bottom: 200 };
  const view = { dom: editor, state: { selection: { head: 1 } }, coordsAtPos: () => caret } as unknown as EditorView;
  return { stage, caret, view };
}

it('键盘与菜单事务滚动避让包含表格上下文行的整个吸顶栏', () => {
  const { stage, view } = fixture();
  expect(scrollEditorSelectionIntoView(view)).toBe(true);
  // 原本只避开52px格式栏会不滚动；现需露出110px共同工具栏下面的光标。
  expect(stage.scrollTop).toBe(460);
});

it('已在共同工具栏下方的选区保持阅读位置', () => {
  const { stage, view, caret } = fixture();
  caret.top = 240; caret.bottom = 260;
  scrollEditorSelectionIntoView(view);
  expect(stage.scrollTop).toBe(500);
});

it('未吸顶工具栏不限制其上方的正文，底部仍最小幅度滚动', () => {
  const { stage, view, caret } = fixture(250);
  scrollEditorSelectionIntoView(view);
  expect(stage.scrollTop).toBe(500);
  caret.top = 580; caret.bottom = 610;
  scrollEditorSelectionIntoView(view);
  expect(stage.scrollTop).toBe(526);
});
