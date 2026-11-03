import { createRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MilkdownNoteEditor } from '../editor/MilkdownNoteEditor';
import type { EditorCommandTarget } from '../editor/editorCommands';
import { createWorkspaceResourcePolicy } from './resourcePolicy';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const canonical = '/api/task-workspaces/workspace/documents/doc/attachments/image/content';
it('allows only exact metadata-owned canonical resources', () => {
  const policy = createWorkspaceResourcePolicy('workspace', 'doc', ['image']);
  expect(policy.resolveImage(canonical)).toBe(canonical);
  for (const source of ['https://remote.invalid/image.png', '//remote.invalid/a', 'data:image/png;base64,aaa', 'blob:unowned', 'file:///secret', '/api/attachments/private/content', canonical + '?x=1', canonical.replace('doc/', 'other/'), canonical.replace('image', '%69mage'), canonical.replace('/doc/', '/doc/../doc/')]) expect(policy.resolveImage(source)).toBeNull();
});
it('blocks initial, replaced and inserted remote images before assigning DOM src while preserving Markdown', async () => {
  const ref = createRef<EditorCommandTarget>();
  const ready = vi.fn();
  const policy = createWorkspaceResourcePolicy('workspace', 'doc', ['image']);
  const rendered = render(<MilkdownNoteEditor ref={ref} noteId="synthetic-task" markdown={`![remote](https://remote.invalid/pixel.png)\n\n![owned](${canonical})`} readOnly={false} resourcePolicy={policy} onChange={vi.fn()} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalled());
  const images = [...rendered.container.querySelectorAll('img[data-editor-image]')];
  expect(images.map(image => image.getAttribute('src'))).toEqual([null, canonical]);
  expect(ref.current?.getMarkdown()).toContain('https://remote.invalid/pixel.png');
  act(() => { ref.current?.setMarkdown('![blocked](data:image/png;base64,aaa)'); });
  await waitFor(() => expect(rendered.container.querySelector('img[data-editor-image]')).not.toHaveAttribute('src'));
  act(() => { ref.current?.insertImage('https://remote.invalid/late.png', 'late'); });
  expect([...rendered.container.querySelectorAll('img[data-editor-image]')].every(image => !image.hasAttribute('src'))).toBe(true);
});
it('leaves ordinary private-note image rendering unchanged when policy is omitted', async () => {
  const ready = vi.fn();
  const rendered = render(<MilkdownNoteEditor noteId="synthetic-private" markdown="![existing](https://remote.invalid/existing.png)" readOnly onChange={vi.fn()} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalled());
  expect(rendered.container.querySelector('img[data-editor-image]')).toHaveAttribute('src', 'https://remote.invalid/existing.png');
});

it('does not render navigable private note links or HTML resource nodes', async () => {
  const ready = vi.fn();
  const rendered = render(<MilkdownNoteEditor noteId="synthetic-links" markdown={'[private](#/materials/notes/private)\n\n<img src="https://remote.invalid/html.png">\n\n<div style="background:url(https://remote.invalid/background.png)">x</div>'} readOnly resourcePolicy={createWorkspaceResourcePolicy('workspace', 'doc', [])} onChange={vi.fn()} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalled());
  expect(rendered.container.querySelector('a[href]')).toBeNull();
  expect(rendered.container.querySelector('img[src],iframe,object,video,svg,[style*="url("]')).toBeNull();
});

it('generates frozen-version requests and uses only host-owned upload previews', () => {
  const policy = createWorkspaceResourcePolicy('workspace', 'doc', ['image'], { versionId: 'frozen', previews: new Map([[canonical, 'blob:owned-preview']]) });
  expect(policy.resolveImage(canonical)).toBe('blob:owned-preview');
  expect(policy.resolveImage('blob:owned-preview')).toBeNull();
  expect(createWorkspaceResourcePolicy('workspace', 'doc', ['image'], { versionId: 'frozen' }).resolveImage(canonical)).toBe(canonical + '?versionId=frozen');
  expect(policy.resolveImage(canonical + '?versionId=other')).toBeNull();
});
