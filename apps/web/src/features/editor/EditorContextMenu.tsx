import { useRef, useState, type Key, type ReactElement } from 'react';
import {
  Menu,
  MenuHeader,
  MenuItem,
  MenuPopover,
  MenuSection,
  MenuSeparator,
  PointMenu,
  SubmenuTrigger
} from '../../components/ui/overlay';
import {
  BoldIcon,
  CodeIcon,
  CopyIcon,
  CutIcon,
  DeleteIcon,
  HighlightIcon,
  HorizontalRuleIcon,
  ImageIcon,
  IndentIcon,
  ItalicIcon,
  ListIcon,
  OrderedListIcon,
  OutdentIcon,
  ParagraphAddIcon,
  PasteIcon,
  QuoteIcon,
  StrikethroughIcon,
  TableIcon,
  TaskListIcon
} from '../../components/icons/knowra';
import type { EditorCommand, EditorEditAction } from './editorCommands';
import { getEditorShortcutLabel } from './editorShortcuts';
import styles from './EditorContextMenu.module.css';

interface EditorContextMenuProps {
  children: ReactElement;
  enabled: boolean;
  canEdit: boolean;
  extendedWritesEnabled?: boolean;
  onRunCommand(command: EditorCommand): void;
  onEditAction(action: EditorEditAction): void;
  onInsertImage(): void;
  onCreateAnnotation(): void;
}

type ContextAction = EditorCommand | Extract<EditorEditAction, 'cut' | 'copy' | 'paste'> | 'create-annotation';

const editActions = new Set<ContextAction>(['cut', 'copy', 'paste']);

export function EditorContextMenu({
  children,
  enabled,
  canEdit,
  extendedWritesEnabled = true,
  onRunCommand,
  onEditAction,
  onInsertImage,
  onCreateAnnotation
}: EditorContextMenuProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  if (!enabled) return children;

  const runAction = (key: Key) => {
    const action = String(key) as ContextAction;
    if (action === 'create-annotation') onCreateAnnotation();
    else if (editActions.has(action)) onEditAction(action as 'cut' | 'copy' | 'paste');
    else onRunCommand(action as EditorCommand);
  };

  return (
    <div
      ref={targetRef}
      className={styles.target}
      onContextMenu={(event) => {
        event.preventDefault();
        // 直接以坐标定位，不再经过隐藏按钮和合成事件，菜单在同一帧内出现。
        setPoint({ x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      <PointMenu
        point={point}
        popoverClassName={styles.popover}
        onOpenChange={(open) => {
          if (open) return;
          setPoint(null);
          window.requestAnimationFrame(() => {
            targetRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
          });
        }}
      >
        <Menu ariaLabel="编辑器右键快捷功能" className={styles.menu} onAction={runAction} onClose={() => setPoint(null)}>
          <MenuSection className={styles.toolRow}>
            <MenuHeader className={styles.srOnly}>编辑</MenuHeader>
            {toolItem('cut', '剪切', <CutIcon size={16} />, !canEdit)}
            {toolItem('copy', '复制', <CopyIcon size={16} />)}
            {toolItem('paste', '粘贴', <PasteIcon size={16} />, !canEdit)}
            {toolItem('delete-selection', '删除', <DeleteIcon size={16} />, !canEdit)}
          </MenuSection>
          <MenuSection className={styles.toolRow}>
            <MenuHeader className={styles.srOnly}>格式</MenuHeader>
            {toolItem('bold', '加粗', <BoldIcon size={16} />, !canEdit)}
            {toolItem('italic', '斜体', <ItalicIcon size={16} />, !canEdit)}
            {toolItem('highlight', '高亮', <HighlightIcon size={16} />, !canEdit)}
            {toolItem('inline-code', '行内代码', <CodeIcon size={16} />, !canEdit)}
            {toolItem('strikethrough', '删除线', <StrikethroughIcon size={16} />, !canEdit)}
            {toolItem('blockquote', '引用', <QuoteIcon size={16} />, !canEdit)}
          </MenuSection>
          <MenuSection className={styles.toolRow}>
            <MenuHeader className={styles.srOnly}>列表与缩进</MenuHeader>
            {toolItem('ordered-list', '有序列表', <OrderedListIcon size={16} />, !canEdit)}
            {toolItem('bullet-list', '无序列表', <ListIcon size={16} />, !canEdit)}
            {toolItem('task-list', '任务列表', <TaskListIcon size={16} />, !canEdit)}
            {toolItem('outdent', '减少缩进', <OutdentIcon size={16} />, !canEdit)}
            {toolItem('indent', '增加缩进', <IndentIcon size={16} />, !canEdit)}
          </MenuSection>

          <MenuSeparator className={styles.fullRow} />
          <MenuItem id="create-annotation" icon={<HighlightIcon size={15} />} isDisabled={!canEdit || !extendedWritesEnabled}>标记为重要内容</MenuItem>
          <SubmenuTrigger delay={80}>
            <MenuItem id="heading-menu" className={styles.submenuTrigger}>标题</MenuItem>
            <MenuPopover placement="end top" offset={-1} containerPadding={12} className={styles.submenuPopover}>
              <Menu ariaLabel="标题样式" className={styles.submenu} onAction={runAction} onClose={() => setPoint(null)}>
                <MenuItem id="paragraph" kbd={getEditorShortcutLabel('paragraph')} isDisabled={!canEdit}>段落</MenuItem>
                <MenuItem id="heading-1" kbd={getEditorShortcutLabel('heading-1')} isDisabled={!canEdit}>H1</MenuItem>
                <MenuItem id="heading-2" kbd={getEditorShortcutLabel('heading-2')} isDisabled={!canEdit}>H2</MenuItem>
                <MenuItem id="heading-3" kbd={getEditorShortcutLabel('heading-3')} isDisabled={!canEdit}>H3</MenuItem>
                <MenuItem id="heading-4" kbd={getEditorShortcutLabel('heading-4')} isDisabled={!canEdit}>H4</MenuItem>
              </Menu>
            </MenuPopover>
          </SubmenuTrigger>
          <SubmenuTrigger delay={80}>
            <MenuItem id="insert-menu" className={styles.submenuTrigger}>插入</MenuItem>
            <MenuPopover placement="end top" offset={-1} containerPadding={12} className={styles.submenuPopover}>
              <Menu ariaLabel="插入内容" className={styles.submenu} onAction={runAction} onClose={() => setPoint(null)}>
                <MenuItem id="table" icon={<TableIcon size={15} />} isDisabled={!canEdit}>表格</MenuItem>
                <MenuItem id="horizontal-rule" icon={<HorizontalRuleIcon size={15} />} isDisabled={!canEdit}>水平分割线</MenuItem>
                <MenuItem id="code-block" icon={<CodeIcon size={15} />} isDisabled={!canEdit}>代码块</MenuItem>
                <MenuItem id="math-block" kbd={getEditorShortcutLabel('math-block')} isDisabled={!canEdit}>公式块</MenuItem>
                <MenuItem id="blockquote" icon={<QuoteIcon size={15} />} isDisabled={!canEdit}>引用</MenuItem>
                <MenuItem id="image" icon={<ImageIcon size={15} />} isDisabled={!canEdit || !extendedWritesEnabled} onAction={onInsertImage}>图片</MenuItem>
                <MenuSeparator />
                <MenuItem id="paragraph-above" icon={<ParagraphAddIcon size={15} position="above" />} isDisabled={!canEdit}>在上方插入段落</MenuItem>
                <MenuItem id="paragraph-below" icon={<ParagraphAddIcon size={15} />} isDisabled={!canEdit}>在下方插入段落</MenuItem>
              </Menu>
            </MenuPopover>
          </SubmenuTrigger>
        </Menu>
      </PointMenu>
    </div>
  );
}

/** 图标工具按钮：名称只给读屏和悬停提示，菜单里不再占用整行文字。 */
function toolItem(id: ContextAction, label: string, icon: ReactElement, disabled = false) {
  return (
    <MenuItem id={id} textValue={label} aria-label={label} icon={icon} isDisabled={disabled} className={styles.toolItem}>
      <span className={styles.srOnly}>{label}</span>
      <span className={styles.hit} title={label} aria-hidden="true" />
    </MenuItem>
  );
}
