import type { ReactNode, Ref } from 'react';
import { EditorToolbarMenu as ToolbarMenu } from './EditorToolbarMenu';
import { PressableButton } from '../../components/ui/button';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '../../components/ui/overlay';
import {
  CodeIcon, ImageIcon, ListIcon, MoreVerticalIcon, PanelIcon, PlusIcon,
  QuoteIcon, StarIcon, TableIcon
} from '../../components/icons/knowra';
import type { EditorCommand } from './editorCommands';
import type { EditorFileAction } from './editorCommands';
import { EditorTableSizePicker } from './EditorTableSizePicker';
import { renderEditorFileMenu } from './EditorFileMenu';
import { renderEditorEditMenu } from './EditorEditMenu';
import { renderEditorFormatMenu } from './EditorFormatMenu';
import { renderEditorParagraphMenu } from './EditorParagraphMenu';
import { renderEditorViewMenu } from './EditorViewMenu';
import type { EditorEditAction } from './editorCommands';
import type { EditorViewAction, EffectiveEditorViewState } from './editorViewState';
import styles from './NoteEditorView.module.css';

export interface EditorToolbarProps {
  toolbarRef: Ref<HTMLDivElement>;
  pinned: boolean;
  favorite: boolean;
  favoritePending: boolean;
  canWrite: boolean;
  canEditContent: boolean;
  canInsertImage?: boolean;
  inspectorOpen: boolean;
  view: EffectiveEditorViewState;
  onRunCommand(command: EditorCommand): void;
  onEditAction(action: EditorEditAction): void;
  onViewAction(action: EditorViewAction): void;
  onFileAction(action: EditorFileAction): void;
  onToggleFavorite(): void;
  onToggleInspector(): void;
  onInsertImage(): void;
  onInsertTable(rows: number, columns: number): void;
}

export function EditorToolbar(props: EditorToolbarProps) {
  const command = (value: EditorCommand) => () => props.onRunCommand(value);
  return (
    <div ref={props.toolbarRef} className={styles.toolbarStack} data-editor-toolbar-stack data-pdf-exclude="true" data-pinned={props.pinned || undefined}>
    <div className={styles.toolbar} data-pinned={props.pinned || undefined} role="toolbar" aria-label="笔记格式工具栏">
      <div className={styles.toolbarMenus} aria-label="编辑器菜单">
        <ToolbarMenu label="文件">{renderEditorFileMenu({
          canWrite: props.canWrite,
          favorite: props.favorite,
          onAction: props.onFileAction
        })}</ToolbarMenu>
        <ToolbarMenu label="段落" disabled={!props.canEditContent}>
          {renderEditorParagraphMenu({ onCommand: props.onRunCommand })}
        </ToolbarMenu>
        <ToolbarMenu label="编辑">
          {renderEditorEditMenu({ canWrite: props.canEditContent, onAction: props.onEditAction })}
        </ToolbarMenu>
        <ToolbarMenu label="格式" disabled={!props.canEditContent}>
          {renderEditorFormatMenu({ onCommand: props.onRunCommand, onInsertImage: props.onInsertImage, canInsertImage: props.canInsertImage })}
        </ToolbarMenu>
        <ToolbarMenu label="视图">{renderEditorViewMenu({ view: props.view, onAction: props.onViewAction })}</ToolbarMenu>
      </div>
      <div className={styles.toolbarTools}>
      <span className={styles.separator} aria-hidden="true" />
      <FormatButton label="一级标题" disabled={!props.canEditContent} onPress={command('heading-1')}><strong>H1</strong></FormatButton>
      <FormatButton label="二级标题" disabled={!props.canEditContent} onPress={command('heading-2')}><strong>H2</strong></FormatButton>
      <FormatButton label="三级标题" disabled={!props.canEditContent} onPress={command('heading-3')}><strong>H3</strong></FormatButton>
      <span className={styles.separator} aria-hidden="true" />
      <FormatButton label="加粗" disabled={!props.canEditContent} onPress={command('bold')}><strong>B</strong></FormatButton>
      <FormatButton label="斜体" disabled={!props.canEditContent} onPress={command('italic')}><em>I</em></FormatButton>
      <FormatButton label="行内代码" disabled={!props.canEditContent} onPress={command('inline-code')}><CodeIcon size={16} /></FormatButton>
      <span className={styles.separator} aria-hidden="true" />
      <FormatButton label="无序列表" disabled={!props.canEditContent} onPress={command('bullet-list')}><ListIcon size={16} /></FormatButton>
      <FormatButton label="引用" disabled={!props.canEditContent} onPress={command('blockquote')}><QuoteIcon size={16} /></FormatButton>
      <EditorTableSizePicker className={styles.optionalTool} disabled={!props.canEditContent} onInsert={props.onInsertTable}><TableIcon size={16} /></EditorTableSizePicker>
      <FormatButton label="插入图片" optional disabled={!props.canEditContent || props.canInsertImage === false} onPress={props.onInsertImage}><ImageIcon size={16} /></FormatButton>
      <span className={`${styles.toolbarSpacer} ${styles.compactHide}`} />
      <span className={`${styles.separator} ${styles.compactHide}`} aria-hidden="true" />
      <PressableButton type="button" className={`${styles.plainButton} ${styles.compactHide}`} aria-label={props.favorite ? '取消收藏当前笔记' : '收藏当前笔记'} aria-pressed={props.favorite} isDisabled={!props.canWrite || props.favoritePending} onPress={props.onToggleFavorite}><StarIcon size={16} /></PressableButton>
      <MenuTrigger>
        <PressableButton className={`${styles.plainButton} ${styles.compactHide}`} aria-label="打开插入菜单"><PlusIcon size={16} /></PressableButton>
        <MenuPopover placement="bottom end"><Menu ariaLabel="插入菜单"><MenuItem id="table" isDisabled={!props.canEditContent} onAction={command('table')}>插入 3×3 表格</MenuItem><MenuItem id="image" isDisabled={!props.canEditContent || props.canInsertImage === false} onAction={props.onInsertImage}>插入图片</MenuItem></Menu></MenuPopover>
      </MenuTrigger>
      <PressableButton type="button" className={styles.plainButton} aria-label="切换文档检查器" aria-pressed={props.inspectorOpen} onPress={props.onToggleInspector}><PanelIcon size={16} /></PressableButton>
      <PressableButton type="button" className={`${styles.plainButton} ${styles.compactHide}`} aria-label="更多文档操作（尚未接入）" title="更多文档操作将在后续接入" isDisabled><MoreVerticalIcon size={16} /></PressableButton>
      </div>
    </div>
    </div>
  );
}

function FormatButton({ label, optional = false, disabled = false, title, onPress, children }: {
  label: string; optional?: boolean; disabled?: boolean; title?: string; onPress?(): void; children: ReactNode;
}) {
  return <PressableButton type="button" className={optional ? styles.optionalTool : undefined} aria-label={label} title={title || label} isDisabled={disabled} onPress={onPress}>{children}</PressableButton>;
}
