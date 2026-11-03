import { useEffect, useState, type RefObject } from 'react';
import type { EditorView } from '@milkdown/kit/prose/view';
import { TextSelection } from '@milkdown/kit/prose/state';
import { BoldIcon, ItalicIcon, CodeIcon, StarIcon } from '../../components/icons/knowra';
import { Button, IconButton } from '../../components/ui/button';
import { Menu, MenuItem, MenuPopover, MenuTrigger, SubmenuTrigger } from '../../components/ui/overlay';
import type { AnnotationImportance } from './annotationPayloads';
import { listItemAt } from './editorListAnnotations';
import { captureAnnotationActionTarget, currentAnnotationActionTarget } from './editorAnnotations';
import type { EditorCommand } from './editorCommands';
import styles from './EditorAnnotationActions.module.css';

type Scope = 'selection' | 'blocks' | 'section' | 'list';
interface Props {
  hostRef: RefObject<HTMLDivElement | null>;
  getView(): EditorView | null;
  onCreate(scope: Scope, importance?: AnnotationImportance): Promise<void>;
  onCommand(command: EditorCommand): void;
  onStatus?(message: string): void;
}

export function EditorAnnotationActions({ hostRef, getView, onCreate, onCommand, onStatus }: Props) {
  const [selection, setSelection] = useState<{ x: number; y: number } | null>(null);
  const [block, setBlock] = useState<{ x: number; y: number; pos: number; heading: boolean; list: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateSelection = () => {
      const native = window.getSelection();
      if (!native || native.isCollapsed || !native.anchorNode || !native.focusNode || !host.contains(native.anchorNode) || !host.contains(native.focusNode)) { setSelection(null); return; }
      const rect = native.getRangeAt(0).getBoundingClientRect();
      setSelection({ x: Math.max(8, Math.min(rect.left, window.innerWidth - 230)), y: Math.max(8, rect.top - 36) });
      setBlock(null);
    };
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const hover = (event: PointerEvent) => {
      clearTimeout(hideTimer);
      if (menuOpen || !window.getSelection()?.isCollapsed) return;
      if (event.target instanceof Element && event.target.closest('[data-annotation-actions]')) return;
      const view = getView();
      const target = event.target instanceof Element ? event.target.closest('p,h1,h2,h3,h4,h5,h6,pre,li,blockquote,table,hr') : null;
      if (!view || !target || !view.dom.contains(target)) { hideTimer = setTimeout(() => setBlock(null), 150); return; }
      const rect = target.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(target).lineHeight);
      const isTextBlock = target.matches('p,h1,h2,h3,h4,h5,h6,li,blockquote');
      const lineTop = isTextBlock && Number.isFinite(lineHeight) && lineHeight > 0
        ? Math.max(0, Math.min(Math.floor((event.clientY - rect.top) / lineHeight) * lineHeight, rect.height - lineHeight))
        : 0;
      const lineCenter = isTextBlock && Number.isFinite(lineHeight)
        ? rect.top + lineTop + lineHeight / 2
        : rect.top + Math.min(rect.height, 28) / 2;
      const pos = view.posAtDOM(target, 0);
      const listItem = listItemAt(view.state.doc, pos);
      const list = Boolean(listItem && !listItem.task);
      const itemElement = list ? target.closest('li') : null;
      const itemRect = itemElement?.getBoundingClientRect();
      const stage = view.dom.closest('[data-editor-scroll-root]');
      const stageRect = stage?.getBoundingClientRect();
      const toolbarRect = stage?.querySelector('[aria-label="笔记格式工具栏"]')?.getBoundingClientRect();
      const top = Math.max(4, stageRect?.top ?? 4, toolbarRect?.bottom ?? 4);
      const bottom = Math.min(window.innerHeight - 32, (stageRect?.bottom ?? window.innerHeight) - 32);
      const itemTop = itemRect && itemRect.top >= top && itemRect.top <= bottom ? itemRect.top : lineCenter - 14;
      setBlock({ list, x: Math.max(4, (itemRect?.left ?? rect.left) - 44), y: list ? Math.max(top, Math.min(itemTop, bottom)) : lineCenter - 14, pos, heading: /^H[1-6]$/.test(target.tagName) });
    };
    const hide = () => { setSelection(null); if (!menuOpen) setBlock(null); };
    document.addEventListener('selectionchange', updateSelection);
    document.addEventListener('pointermove', hover);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(hideTimer);
      document.removeEventListener('selectionchange', updateSelection);
      document.removeEventListener('pointermove', hover);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hostRef, getView, menuOpen]);

  async function create(scope: Scope, importance: AnnotationImportance = 'normal') {
    if (pending) return;
    setPending(true);
    try {
      if (scope !== 'selection' && block) {
        const view = getView();
        if (!view) return;
        const target = currentAnnotationActionTarget(view);
        if (target === null) throw new Error('目标内容已变化，请重新选择');
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(target, view.state.doc.content.size)))));
      }
      await onCreate(scope, importance);
      setSelection(null);
      setBlock(null);
    } catch (error) { onStatus?.(error instanceof Error ? error.message : '创建重点失败'); }
    finally { setPending(false); }
  }

  return <>
    {selection ? <div className={styles.toolbar} style={{ left: selection.x, top: selection.y }} role="toolbar" aria-label="选区工具" onMouseDown={(event) => event.preventDefault()}>
      <IconButton className={styles.formatAction} size={24} aria-label="加粗" title="加粗" onPress={() => onCommand('bold')}><BoldIcon size={15} /></IconButton>
      <IconButton className={styles.formatAction} size={24} aria-label="斜体" title="斜体" onPress={() => onCommand('italic')}><ItalicIcon size={15} /></IconButton>
      <IconButton className={styles.formatAction} size={24} aria-label="行内代码" title="行内代码" onPress={() => onCommand('inline-code')}><CodeIcon size={15} /></IconButton>
      <span className={styles.divider} aria-hidden="true" />
      <Button variant="ghost" size="mini" onPress={() => onCommand('internal-link')}>内部链接</Button>
      {IMPORTANCE_LEVELS.map(level => <Button key={level.id} variant="ghost" size="mini" aria-label={`标记重点（${level.label}）`} isDisabled={pending} onPress={() => void create('selection', level.id)} icon={<StarIcon size={15} fill={level.id === 'normal' ? 'none' : 'currentColor'} />}>{level.label}</Button>)}
    </div> : null}
    {block && !selection ? <div data-annotation-actions className={styles.blockAction} style={{ left: block.x, top: block.y }}>
      <MenuTrigger isOpen={menuOpen} onOpenChange={(open) => { if (open) { const view = getView(); if (view) captureAnnotationActionTarget(view, block.pos); } setMenuOpen(open); }}>
        <IconButton aria-label={block.list ? '列表项重点菜单' : block.heading ? '标题重点菜单' : '内容块重点菜单'}>⋮</IconButton>
        <MenuPopover placement="bottom start"><Menu ariaLabel="标记重点">
          <SubmenuTrigger><MenuItem id="blocks" isDisabled={pending}>标记此块为重点</MenuItem>
            <MenuPopover><Menu ariaLabel="此块重点等级">{IMPORTANCE_LEVELS.map(level => <MenuItem key={level.id} id={level.id} isDisabled={pending} onAction={() => void create('blocks', level.id)}>{level.label}</MenuItem>)}</Menu></MenuPopover>
          </SubmenuTrigger>
          {block.list ? <MenuItem id="list" isDisabled={pending} onAction={() => void create('list')}>标记此列表项为重点（包含本项及全部子项）</MenuItem> : null}
          {block.heading ? <SubmenuTrigger><MenuItem id="section" isDisabled={pending}>标记本节为重点</MenuItem>
            <MenuPopover><Menu ariaLabel="本节重点等级">{IMPORTANCE_LEVELS.map(level => <MenuItem key={level.id} id={level.id} isDisabled={pending} onAction={() => void create('section', level.id)}>{level.label}</MenuItem>)}</Menu></MenuPopover>
          </SubmenuTrigger> : null}
        </Menu></MenuPopover>
      </MenuTrigger>
    </div> : null}
  </>;
}

const IMPORTANCE_LEVELS: Array<{ id: AnnotationImportance; label: string }> = [
  { id: 'normal', label: '普通' }, { id: 'important', label: '重点' }, { id: 'core', label: '核心' }
];
