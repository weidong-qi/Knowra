import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EditorCommandTarget } from './editorCommands';
import { EditorFindReplacePanel } from './EditorFindReplacePanel';

function createEditor(): EditorCommandTarget {
  return {
    run: vi.fn(), runEdit: vi.fn(), focus: vi.fn(), clearFind: vi.fn(), navigateToHeading: vi.fn(), getAnnotationSelection: vi.fn(), setAnnotations: vi.fn(), selectAnnotation: vi.fn(), insertImage: vi.fn(), insertLink: vi.fn(), setMarkdown: vi.fn(), replaceMarkdown: vi.fn(),
    getMarkdown: vi.fn(), getHtml: vi.fn(),
    find: vi.fn().mockReturnValue({ found: true, count: 2, index: 0 }),
    replaceCurrent: vi.fn().mockReturnValue({ found: true, count: 1, index: 0, replaced: 1 }),
    replaceAll: vi.fn().mockReturnValue({ found: false, count: 0, index: -1, replaced: 2 })
  };
}

describe('EditorFindReplacePanel', () => {
  it('finds next and previous matches through the typed editor adapter', async () => {
    const user = userEvent.setup();
    const editor = createEditor();
    render(<EditorFindReplacePanel mode="find" editor={editor} onClose={vi.fn()} onStatus={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: '查找内容' }), '知识');
    await user.click(screen.getByRole('button', { name: '下一处' }));
    expect(editor.find).toHaveBeenCalledWith('知识', -1, 'next');
    expect(screen.getByRole('status')).toHaveTextContent('第 1 / 2 处');
  });

  it('replaces all matches without using a native prompt', async () => {
    const user = userEvent.setup();
    const editor = createEditor();
    render(<EditorFindReplacePanel mode="replace" editor={editor} onClose={vi.fn()} onStatus={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: '查找内容' }), '旧文字');
    await user.type(screen.getByRole('textbox', { name: '替换为' }), '新文字');
    await user.click(screen.getByRole('button', { name: '全部替换' }));
    expect(editor.replaceAll).toHaveBeenCalledWith('旧文字', '新文字');
  });

  it('closes with Escape even after find returns focus to the editor', async () => {
    const user = userEvent.setup();
    const editor = createEditor();
    const onClose = vi.fn();
    render(<EditorFindReplacePanel mode="find" editor={editor} onClose={onClose} onStatus={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: '查找内容' }), '知识');
    await user.click(screen.getByRole('button', { name: '下一处' }));
    await user.keyboard('{Escape}');
    expect(editor.clearFind).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
