/* Knowra 组件类型（由 tsc 从 apps/web-v4/src/components/ui 生成，仅作文档）。
 * 运行时：window.Knowra.<组件>；图标：window.Knowra.Icons.<名称>Icon。 */
import type { ReactNode, Key, HTMLAttributes, InputHTMLAttributes } from 'react';

// ---- tokens
export declare const CANONICAL_COLOR_TOKENS: readonly ['ink-bg', 'ink-surface', 'ink-sunken', 'ink', 'ink-secondary', 'ink-muted', 'ink-panel', 'ink-dot', 'ink-accent', 'ink-accent-hover', 'ink-accent-soft', 'ink-cover-shadow', 'ink-success', 'ink-success-soft', 'ink-warning', 'ink-warning-soft', 'ink-danger', 'ink-danger-soft', 'ink-shell'];
export declare const CANONICAL_SIZE_TOKENS: readonly ['rail-size', 'sidebar-size', 'sidebar-size-narrow', 'inspector-size', 'docbar-size', 'status-size', 'mobile-tabs-size'];
export declare const CANONICAL_SHADOW_TOKENS: readonly ['shadow-1', 'shadow-2', 'shadow-focus'];
/** 输入控件的扩展语义：阴影始终落在可见外壳，不落在原生控件。 */
export declare const INPUT_SHADOW_TOKENS: readonly ['shadow-input-rest', 'shadow-input-focus', 'shadow-input-invalid'];
export declare const CANONICAL_MOTION_TOKENS: readonly ['motion-fast', 'motion-mid', 'motion-ease'];
export declare const CANONICAL_FONT_TOKENS: readonly ['font-ui', 'font-mono'];
export type CanonicalColorToken = (typeof CANONICAL_COLOR_TOKENS)[number];
export type CanonicalSizeToken = (typeof CANONICAL_SIZE_TOKENS)[number];
export type CanonicalShadowToken = (typeof CANONICAL_SHADOW_TOKENS)[number];
export type InputShadowToken = (typeof INPUT_SHADOW_TOKENS)[number];
export type CanonicalMotionToken = (typeof CANONICAL_MOTION_TOKENS)[number];
export type CanonicalFontToken = (typeof CANONICAL_FONT_TOKENS)[number];
export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

// ---- button/Button
import { type ButtonProps as RAButtonProps } from 'react-aria-components';
export interface ButtonProps extends Omit<RAButtonProps, 'className' | 'children' | 'isPending'> {
    /**
     * 视觉变体：
     * - `primary` 主操作 / `default` 普通 / `ghost` 弱化 / `danger` 危险。
     */
    variant?: ButtonVariant;
    /** 工作区工具栏、分组标题、密集卡片的尺寸；视觉规则统一由本组件维护。 */
    size?: 'default' | 'workspace' | 'compact' | 'mini' | 'toolbar' | 'footer';
    /** 小型操作默认胶囊；square 为小圆角矩形，不随主题变为胶囊。 */
    shape?: 'square' | 'pill';
    /** 低强调蓝色操作，用于卡片内的“查看”等入口。 */
    emphasis?: 'normal' | 'soft';
    /** 图标（仅 icon 模式时作为主内容；其它模式可与 label 并列）。 */
    icon?: ReactNode;
    /** 提交/保存中状态，禁用按压但保留焦点。 */
    isPending?: boolean;
    children?: ReactNode;
    className?: string;
}
export declare const Button: import("react").ForwardRefExoticComponent<ButtonProps & import("react").RefAttributes<HTMLButtonElement>>;

// ---- button/IconButton
export interface IconButtonProps extends Omit<RAButtonProps, 'children' | 'aria-label' | 'className'> {
    /**
     * 必填：a11y 标签。按钮内容只有图标，必须有 aria-label 才能被屏读器识别。
     * （HTML 原生 aria-label 是 string|undefined，这里收紧为 string 强制填写。）
     */
    'aria-label': string;
    /** 必填：图标 SVG。业务代码统一从 `components/icons/knowra` 选择。 */
    children: ReactNode;
    /**
     * 容器尺寸（px），决定方块边长。常见值：
     * - 30：侧栏头部、Tab 端点；
     * - 28：顶部浏览历史；
     * - 40：与左轨 ModuleRail 内部网格对齐；
     * - 24：紧凑列表行内嵌。
     * @default 30
     */
    size?: 24 | 28 | 30 | 40;
    tone?: 'ghost' | 'floating' | 'primary';
    /** 与 Button 一致的禁用入口。 */
    isDisabled?: boolean;
    /** 兼容原生按钮调用方式；内部映射为 React Aria 的 isDisabled。 */
    disabled?: boolean;
    className?: string;
    title?: string;
}
export declare const IconButton: import("react").ForwardRefExoticComponent<IconButtonProps & import("react").RefAttributes<HTMLButtonElement>>;

// ---- button/SegmentedControl
export declare function SegmentedControl({ className, children, variant, density, ...rest }: HTMLAttributes<HTMLDivElement> & {
    variant?: 'default' | 'underline';
    density?: 'regular' | 'compact' | 'comfortable';
}): import("react").JSX.Element;
export interface SegmentedButtonProps extends Omit<RAButtonProps, 'className' | 'children'> {
    count?: number;
    iconOnly?: boolean;
    children: ReactNode;
    className?: string;
}
export declare const SegmentedButton: import("react").ForwardRefExoticComponent<SegmentedButtonProps & import("react").RefAttributes<HTMLButtonElement>>;

// ---- button/PressableButton
export interface PressableButtonProps extends Omit<RAButtonProps, 'className' | 'children'> {
    children: ReactNode;
    className?: string;
    /** 业务需要组合 tab/treeitem 等原生语义时显式透传。 */
    role?: AriaRole;
    tabIndex?: number;
    title?: string;
    'aria-selected'?: boolean;
    /** menuitemcheckbox / menuitemradio 的选中状态。 */
    'aria-checked'?: boolean;
}
/**
 * 仅提供 React Aria 的按压与焦点契约，不附加任何视觉样式。
 * 适用于目录树、列表行等由业务 CSS Module 完整定义外观的按钮。
 */
export declare const PressableButton: import("react").ForwardRefExoticComponent<PressableButtonProps & import("react").RefAttributes<HTMLButtonElement>>;

// ---- input/Input
import { FieldError, Input as RAInput, Label, Text, type TextFieldProps as RATextFieldProps } from 'react-aria-components';
export interface TextFieldProps extends Omit<RATextFieldProps, 'className' | 'children'> {
    label: string;
    description?: string;
    errorMessage?: string | ((validation: {
        isInvalid: boolean;
        validationErrors?: string[];
    }) => string);
    placeholder?: string;
    isRequired?: boolean;
    isInvalid?: boolean;
    isDisabled?: boolean;
    className?: string;
    inputClassName?: string;
    type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
    children?: (childProps: {
        input: typeof RAInput;
        label: typeof Label;
        description: typeof Text;
        error: typeof FieldError;
    }) => ReactNode;
}
export declare const TextField: import("react").ForwardRefExoticComponent<TextFieldProps & import("react").RefAttributes<HTMLDivElement>>;

// ---- input/TextAreaField
import { type TextFieldProps as RATextFieldProps } from 'react-aria-components';
export interface TextAreaFieldProps extends Omit<RATextFieldProps, 'className' | 'children'> {
    label: string;
    presentation?: 'field' | 'composer';
    description?: string;
    errorMessage?: string;
    placeholder?: string;
    rows?: number;
    className?: string;
}
export declare const TextAreaField: import("react").ForwardRefExoticComponent<TextAreaFieldProps & import("react").RefAttributes<HTMLDivElement>>;

// ---- input/SearchBox
export type SearchBoxSize = 'toolbar' | 'sidebar' | 'command' | 'field';
interface SearchSurfaceProps {
    children: ReactNode;
    icon?: ReactNode;
    size?: SearchBoxSize;
    shortcut?: string;
    onClear?: () => void;
    clearLabel?: string;
    clearText?: string;
    disabled?: boolean;
    invalid?: boolean;
    surfaceProps?: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'> & {
        'data-shadow-owner'?: string;
        'data-shadow-token'?: string;
    };
}
/** 搜索控件的唯一视觉外壳；业务页面不再维护搜索框 CSS。 */
export declare function SearchSurface({ children, icon, size, shortcut, onClear, clearLabel, clearText, disabled, invalid, surfaceProps }: SearchSurfaceProps): import("react").JSX.Element;
export interface SearchBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children' | 'className' | 'size' | 'aria-label'> {
    label: string;
    icon?: ReactNode;
    size?: SearchBoxSize;
    shortcut?: string;
    onClear?: () => void;
    clearLabel?: string;
    clearText?: string;
    surfaceProps?: SearchSurfaceProps['surfaceProps'];
}
/** 原生输入行为留给调用方，样式和可选附件由组件库统一提供。 */
export declare const SearchBox: import("react").ForwardRefExoticComponent<SearchBoxProps & import("react").RefAttributes<HTMLInputElement>>;

// ---- input/Select
import { type SelectProps as RASelectProps, type Key } from 'react-aria-components';
export interface SelectOption {
    id: string;
    label: string;
    description?: string;
    isDisabled?: boolean;
}
export interface SelectProps<T extends Key = string> extends Omit<RASelectProps<T>, 'className' | 'children'> {
    label: string;
    description?: string;
    errorMessage?: string;
    placeholder?: string;
    isRequired?: boolean;
    isInvalid?: boolean;
    isDisabled?: boolean;
    options: SelectOption[];
    /** 工具栏中的紧凑筛选框；标签仍提供给辅助技术。 */
    presentation?: 'field' | 'toolbar';
    leadingIcon?: ReactNode;
    className?: string;
    children?: ReactNode;
}
export declare const Select: import("react").ForwardRefExoticComponent<SelectProps<string> & import("react").RefAttributes<HTMLDivElement>>;

// ---- input/Checkbox
import { type CheckboxProps as RACheckboxProps } from 'react-aria-components';
export interface CheckboxProps extends Omit<RACheckboxProps, 'className' | 'children'> {
    children?: ReactNode;
    className?: string;
    indeterminateIcon?: ReactNode;
    size?: 'default' | 'compact';
}
export declare const Checkbox: import("react").ForwardRefExoticComponent<CheckboxProps & import("react").RefAttributes<HTMLLabelElement>>;

// ---- input/Switch
import { type SwitchProps as RASwitchProps } from 'react-aria-components';
export interface SwitchProps extends Omit<RASwitchProps, 'className' | 'children'> {
    children: ReactNode;
    className?: string;
}
export declare const Switch: import("react").ForwardRefExoticComponent<SwitchProps & import("react").RefAttributes<HTMLLabelElement>>;

// ---- file/FileDropField
export interface FileDropFieldProps {
    accept: string;
    multiple?: boolean;
    isDisabled?: boolean;
    label: string;
    description: string;
    onSelect(files: File[]): void;
}
export declare function FileDropField({ accept, multiple, isDisabled, label, description, onSelect }: FileDropFieldProps): import("react").JSX.Element;

// ---- collection/Tabs
import { type TabsProps as RATabsProps, type Key } from 'react-aria-components';
export interface TabsItem {
    id: Key;
    label: string;
    badge?: string | number;
    isDisabled?: boolean;
}
export interface TabsProps extends Omit<RATabsProps, 'className' | 'children'> {
    items: TabsItem[];
    className?: string;
    /** 渲染每个 Tab 的内容；用于自定 badge / icon。 */
    renderTab?: (item: TabsItem) => ReactNode;
    /** 渲染每个 Panel 的内容；默认用 id 找 children[key]。 */
    children: (item: TabsItem) => ReactNode;
}
export declare const Tabs: import("react").ForwardRefExoticComponent<TabsProps & import("react").RefAttributes<HTMLDivElement>>;

// ---- navigation/SideNavItem
export interface SideNavItemProps extends Omit<PressableButtonProps, 'children'> {
    label: ReactNode;
    icon?: ReactNode;
    count?: ReactNode;
    density?: 'regular' | 'compact';
}
/** 普通侧栏导航项；由调用方使用 aria-pressed 或 aria-current 表达当前状态。 */
export declare const SideNavItem: import("react").ForwardRefExoticComponent<SideNavItemProps & import("react").RefAttributes<HTMLButtonElement>>;

// ---- collection/Tree
import { type TreeItemContentProps as RATreeItemContentProps, type TreeItemProps as RATreeItemProps, type TreeProps as RATreeProps } from 'react-aria-components';
export interface TreeItemData {
    id: string;
    label: string;
    /** 子节点；为空则是叶子。 */
    children?: TreeItemData[];
    /** 右侧灰色计数；用于目录树显示资料数。 */
    count?: number;
    isDisabled?: boolean;
}
export interface TreeProps<T extends TreeItemData> extends Omit<RATreeProps<T>, 'className' | 'children' | 'items'> {
    items: T[];
    /** 每行额外的视觉元素（状态点、操作按钮）。 */
    renderExtras?: (item: T) => ReactNode;
    className?: string;
    ariaLabel?: string;
}
export declare function Tree<T extends TreeItemData>({ items, renderExtras, className, ariaLabel, ...rest }: TreeProps<T>): import("react").JSX.Element;
export declare const TreeItem: import("react").ForwardRefExoticComponent<Omit<RATreeItemProps<object>, "className"> & {
    children: ReactNode;
    className?: string;
} & import("react").RefAttributes<HTMLDivElement>>;
export declare const TreeItemContent: import("react").ForwardRefExoticComponent<RATreeItemContentProps & import("react").RefAttributes<Element>>;

// ---- collection/TagGroup
import { type Key, type TagGroupProps as RATagGroupProps, type TagListProps as RATagListProps, type TagProps as RATagProps } from 'react-aria-components';
export interface TagItem {
    id: string;
    label: string;
    isDisabled?: boolean;
    /** 状态色；决定边框/文字/点的色相（与 Badge tone 同源）。 */
    tone?: StatusTone;
    /** 隐藏前导方点（默认显示）。 */
    hideDot?: boolean;
    /** 计数小角标，等宽数字后置。 */
    count?: number;
}
export type TagGroupProps = Omit<RATagGroupProps, 'className' | 'children'> & {
    /** 同时作为可见的组标签头与 aria-label。 */
    label: string;
    items: TagItem[];
    ariaLabel?: string;
    className?: string;
    /** 是否渲染可见的组标签头；默认 true。 */
    visibleLabel?: boolean;
    /** 组右侧的辅助信息（计数、状态等）。 */
    trailing?: ReactNode;
    /**
     * 移除回调；当提供时，每个 tag 会自动渲染一个内置的 remove 按钮。
     * 实际状态由调用方维护（推荐受控：传 defaultSelectedKeys / selectedKeys + onSelectionChange）。
     */
    onRemove?: (keys: Set<Key>) => void;
};
export declare const TagGroup: import("react").ForwardRefExoticComponent<Omit<RATagGroupProps, "children" | "className"> & {
    /** 同时作为可见的组标签头与 aria-label。 */
    label: string;
    items: TagItem[];
    ariaLabel?: string;
    className?: string;
    /** 是否渲染可见的组标签头；默认 true。 */
    visibleLabel?: boolean;
    /** 组右侧的辅助信息（计数、状态等）。 */
    trailing?: ReactNode;
    /**
     * 移除回调；当提供时，每个 tag 会自动渲染一个内置的 remove 按钮。
     * 实际状态由调用方维护（推荐受控：传 defaultSelectedKeys / selectedKeys + onSelectionChange）。
     */
    onRemove?: (keys: Set<Key>) => void;
} & import("react").RefAttributes<HTMLDivElement>>;
export declare const Tag: import("react").ForwardRefExoticComponent<RATagProps & import("react").RefAttributes<HTMLDivElement>>;
export declare const TagList: import("react").ForwardRefExoticComponent<Omit<RATagListProps<TagItem>, "children" | "items"> & {
    items: TagItem[];
} & import("react").RefAttributes<HTMLDivElement>>;

// ---- collection/GridList
import { type GridListItemProps as RAGridListItemProps, type GridListProps as RAGridListProps, type SelectionMode } from 'react-aria-components';
export interface GridListColumn<T> {
    id: string;
    /** 桌面 ≥768 CSS Grid 模板片段，例如 "minmax(220px, 2fr) 0.6fr 0.8fr 0.6fr"。 */
    template: string;
    /** 移动 ≤767 行的"标题"列；第一列永远是标题来源。 */
    title?: boolean;
    /** 桌面与移动的 cell renderer。 */
    cell: (item: T) => ReactNode;
    align?: 'left' | 'right' | 'center';
}
export interface GridListProps<T> extends Omit<RAGridListProps<T>, 'className' | 'children' | 'items'> {
    items: T[];
    columns: GridListColumn<T>[];
    ariaLabel: string;
    getKey: (item: T) => string;
    selectionMode?: SelectionMode;
    emptyState?: ReactNode;
    className?: string;
}
export declare function GridList<T>({ items, columns, ariaLabel, getKey, selectionMode, emptyState, className, ...rest }: GridListProps<T>): import("react").JSX.Element;
export declare const GridListItem: import("react").ForwardRefExoticComponent<RAGridListItemProps<object> & import("react").RefAttributes<HTMLDivElement>>;

// ---- status/Badge
export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    tone?: StatusTone;
    children: ReactNode;
    className?: string;
    /** 隐藏左侧方点；用于纯文字状态。 */
    hideDot?: boolean;
}
export declare const Badge: import("react").ForwardRefExoticComponent<BadgeProps & import("react").RefAttributes<HTMLSpanElement>>;

// ---- overlay/Menu
import { type MenuItemProps as RAMenuItemProps, type MenuProps as RAMenuProps, type MenuTriggerProps as RAMenuTriggerProps, type PopoverProps as RAPopoverProps, type SubmenuTriggerProps as RASubmenuTriggerProps } from 'react-aria-components';
export type MenuItemProps = Omit<RAMenuItemProps, 'className' | 'children'> & {
    icon?: ReactNode;
    /** 右侧提示键位，例如 "⌘K"。 */
    kbd?: string;
    isDanger?: boolean;
    /** 标题下方的一行说明，仅在 `variant="rich"` 的菜单里排版。 */
    description?: string;
    children: ReactNode;
    className?: string;
};
export declare const MenuItem: import("react").ForwardRefExoticComponent<Omit<RAMenuItemProps<object>, "children" | "className"> & {
    icon?: ReactNode;
    /** 右侧提示键位，例如 "⌘K"。 */
    kbd?: string;
    isDanger?: boolean;
    /** 标题下方的一行说明，仅在 `variant="rich"` 的菜单里排版。 */
    description?: string;
    children: ReactNode;
    className?: string;
} & import("react").RefAttributes<HTMLDivElement>>;
export interface MenuProps<T> extends Omit<RAMenuProps<T>, 'className' | 'children'> {
    children: ReactNode;
    className?: string;
    ariaLabel?: string;
    /** `rich`：分组标题、图标底板和说明行的操作面板；默认保持紧凑菜单。 */
    variant?: 'default' | 'rich';
}
export declare function Menu<T extends object>({ children, className, ariaLabel, variant, ...rest }: MenuProps<T>): import("react").JSX.Element;
export interface MenuHeaderProps {
    children: ReactNode;
    className?: string;
}
export declare const MenuHeader: import("react").ForwardRefExoticComponent<MenuHeaderProps & import("react").RefAttributes<HTMLElement>>;
export interface MenuSectionProps {
    children: ReactNode;
    className?: string;
}
export declare const MenuSection: import("react").ForwardRefExoticComponent<MenuSectionProps & import("react").RefAttributes<HTMLElement>>;
export declare const MenuSeparator: import("react").ForwardRefExoticComponent<{
    className?: string;
} & import("react").RefAttributes<HTMLHRElement>>;
export type MenuTriggerProps = Omit<RAMenuTriggerProps, 'children'> & {
    /**
     * 形如 [trigger, popover]。
     * React Aria 的 MenuTrigger 期望 trigger 与 Popover 平级，Popover 内部再放 Menu。
     * 不再在内部自动包裹 Popover，避免破坏 React Aria 的语义。
     */
    children: [ReactNode, ReactNode];
};
export declare function MenuTrigger({ children, ...rest }: MenuTriggerProps): import("react").JSX.Element;
/**
 * 二级菜单继续复用 React Aria 的悬浮延迟、指针安全通道与方向键语义。
 * 业务组件不自行维护 hover timer，避免鼠标跨越主菜单与子菜单时误关闭。
 */
export declare const SubmenuTrigger: (props: RASubmenuTriggerProps & React.RefAttributes<HTMLDivElement>) => import("react").ReactElement<unknown, string | React.JSXElementConstructor<any>> | null;
export type SubmenuTriggerProps = RASubmenuTriggerProps;
/** 复用的 Popover 视觉默认值，业务代码可继续自行传入 placement / offset。 */
export declare const MenuPopover: import("react").ForwardRefExoticComponent<Omit<RAPopoverProps, "children" | "className"> & {
    children: ReactNode;
    className?: string;
} & import("react").RefAttributes<HTMLDivElement>>;

// ---- overlay/PointMenu
export interface PointMenuProps {
    point: {
        x: number;
        y: number;
    } | null;
    onOpenChange(open: boolean): void;
    /** 浮层定位容器的额外类名，用于调整层级或关闭入场动画。 */
    popoverClassName?: string;
    /** 可选工作区边界，避免菜单伸入应用底部导航。 */
    boundaryElement?: Element;
    maxHeight?: number;
    children: ReactNode;
}
/** 为鼠标右键或键盘菜单键提供屏幕坐标锚点，菜单视觉和交互仍由共享 Menu 提供。
 * 此容器不是 MenuTrigger，不会注入菜单选择后的关闭回调。
 * 内部 Menu（含子菜单）须显式接 onClose，或由既有 onAction 清除 point。
 */
export declare function PointMenu({ point, onOpenChange, popoverClassName, boundaryElement, maxHeight, children }: PointMenuProps): import("react").JSX.Element;

// ---- overlay/Popover
import { type DialogProps as RADialogProps, type PopoverProps as RAPopoverProps, type DialogTriggerProps as RADialogTriggerProps } from 'react-aria-components';
export interface PopoverProps extends Omit<RAPopoverProps, 'className' | 'children'> {
    children: ReactNode;
    className?: string;
}
export declare const Popover: import("react").ForwardRefExoticComponent<PopoverProps & import("react").RefAttributes<HTMLDivElement>>;
export type PopoverTriggerProps = Omit<RADialogTriggerProps, 'children'> & {
    children: [ReactNode, ReactNode];
};
export declare function PopoverTrigger({ children, ...rest }: PopoverTriggerProps): import("react").JSX.Element;
/** 浮层内的语义对话框，提供初始焦点与键盘交互。 */
export declare const PopoverDialog: import("react").ForwardRefExoticComponent<Omit<RADialogProps, "children"> & {
    children: ReactNode;
} & import("react").RefAttributes<HTMLDivElement>>;

// ---- overlay/Tooltip
import { type TooltipProps as RATooltipProps, type TooltipTriggerComponentProps } from 'react-aria-components';
export interface TooltipProps extends Omit<RATooltipProps, 'className' | 'children'> {
    children: ReactNode;
    className?: string;
}
export declare const Tooltip: import("react").ForwardRefExoticComponent<TooltipProps & import("react").RefAttributes<HTMLDivElement>>;
export type TooltipTriggerProps = Omit<TooltipTriggerComponentProps, 'children'> & {
    children: [ReactNode, ReactNode];
    /** 默认 250ms 延迟，可由调用方覆盖。 */
    delay?: number;
    /** 默认 300ms 关闭延迟。 */
    closeDelay?: number;
};
export declare function TooltipTrigger({ children, delay, closeDelay }: TooltipTriggerProps): import("react").JSX.Element;

// ---- overlay/Dialog
import { type DialogProps as RADialogProps, type DialogTriggerProps as RADialogTriggerProps } from 'react-aria-components';
interface DialogCloseContextValue {
    close(): void;
}
/** 在 Dialog 子树内调用以取得 close()；在子树外使用会抛错。 */
export declare function useDialogClose(): DialogCloseContextValue;
export interface DialogProps extends Omit<RADialogProps, 'className' | 'children'> {
    /** 必须：弹窗标题，给 screen reader 与视觉都使用。 */
    title: string;
    /** Dialog 容器内的内容（包含 body / footer）。 */
    children: ReactNode;
    className?: string;
    /** 是否在打开时禁用关闭（例如正在提交中）。 */
    isDismissable?: boolean;
    /** 提交中遮罩，会覆盖 body 内容。 */
    isPending?: boolean;
    /** 描述（同时给 aria-describedby）。 */
    description?: string;
    size?: 'sm' | 'md';
    /** 独立滚动面板，自带可见标题与关闭按钮。 */
    presentation?: 'dialog' | 'panel';
    /** 受控打开状态；与 DialogTrigger 不可同时使用。 */
    isOpen?: boolean;
    /** 受控状态变更回调（关闭、背景点击、Esc）。 */
    onOpenChange?: (open: boolean) => void;
}
export declare const Dialog: import("react").ForwardRefExoticComponent<DialogProps & import("react").RefAttributes<HTMLDivElement>>;
export type DialogTriggerProps = Omit<RADialogTriggerProps, 'children'> & {
    children: [ReactNode, ReactNode];
};
export declare function DialogTrigger({ children, ...rest }: DialogTriggerProps): import("react").JSX.Element;
export declare const DialogBody: import("react").ForwardRefExoticComponent<{
    children: ReactNode;
    className?: string;
} & import("react").RefAttributes<HTMLDivElement>>;
export declare const DialogFooter: import("react").ForwardRefExoticComponent<{
    children: ReactNode;
    className?: string;
} & import("react").RefAttributes<HTMLDivElement>>;
export interface DialogCloseProps {
    /** 视觉变体；与 Button 对齐 */
    variant?: ButtonVariant;
    /** 提交/保存中状态 */
    isPending?: boolean;
    /** 关闭后回调；典型用法：onClose={() => setOpen(false)} */
    onClose?: () => void;
    /** 显式传入 children 时渲染为业务按钮（保留外观并暴露 close 动作）。 */
    children?: ReactNode;
    className?: string;
    /** 任何附加的 ARIA 属性，仅图标形态（无 children）生效。 */
    'aria-label'?: string;
}
/** Dialog 子树内的可访问关闭按钮：
 * - 不传 `children` 时渲染为右上角 "×" 图标按钮（必须配 aria-label）；
 * - 传 `children` 时渲染为业务按钮，视觉复用 Button，关闭动作通过 React Context。 */
export declare const DialogClose: import("react").ForwardRefExoticComponent<DialogCloseProps & import("react").RefAttributes<HTMLButtonElement>>;

// ---- status/Panel
export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
    title?: ReactNode;
    /** 头部右侧的操作区（例如更多按钮、徽章）。 */
    headerActions?: ReactNode;
    /** 底部内容（例如状态行、按钮组）。 */
    footer?: ReactNode;
    /** body 内边距为 0；用于承载表格等自带边距的子内容。 */
    flush?: boolean;
    children: ReactNode;
}
export declare const Panel: import("react").ForwardRefExoticComponent<PanelProps & import("react").RefAttributes<HTMLDivElement>>;

// ---- status/EmptyState
export interface EmptyStateProps {
    title: string;
    description?: string;
    icon?: ReactNode;
    primaryAction?: ReactNode;
    secondaryAction?: ReactNode;
    escapeAction?: ReactNode;
    className?: string;
    /** 角色；默认 status，避免被读屏频繁打断。 */
    role?: 'status' | 'region';
}
export declare const EmptyState: import("react").ForwardRefExoticComponent<EmptyStateProps & import("react").RefAttributes<HTMLDivElement>>;

// ---- status/EmptyArt
export type EmptyArtVariant = 'note' | 'search' | 'knowledge';
/** 空状态插图：两张错落的纸页加一枚强调色徽章，随主题强调色着色；纯装饰，对读屏隐藏。 */
export declare function EmptyArt({ variant, className }: {
    variant?: EmptyArtVariant;
    className?: string;
}): import("react").JSX.Element;

// ---- status/LoadingState
export interface LoadingStateProps {
    label?: string;
    /** 默认四条骨架脉冲；也可使用行内进度条或方点脉冲。 */
    variant?: 'skeleton' | 'bar' | 'dots';
    className?: string;
    children?: ReactNode;
}
export declare const LoadingState: import("react").ForwardRefExoticComponent<LoadingStateProps & import("react").RefAttributes<HTMLDivElement>>;

// ---- status/SkeletonPulse
export interface SkeletonPulseProps {
    className?: string;
}
/** 印格状态板 §7：四条宽度错落、同步呼吸的加载占位。 */
export declare function SkeletonPulse({ className }: SkeletonPulseProps): import("react").JSX.Element;
