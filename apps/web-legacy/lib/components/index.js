/**
 * 前端组件目录（事实上的组件库入口）。
 *
 * 聚合 lib 下各 renderers.js 中纯展示的 render 函数：输入数据、返回 HTML 字符串，
 * 内部自带 escapeHtml/escapeAttribute。控制器按需从本入口统一 import，
 * 不再各自散落引用各 renderer 文件。
 *
 * 后续计划升级为正式代码组件库：以本目录为宿主，补充 manifest 与 JSDoc，
 * 并由此生成供设计师浏览的静态展示手册。
 */

// 基础组件
export { renderIcon } from '../icons/icon-map.js';

// 外壳与导航
export {
  renderModuleRail,
  renderFunctionNavigation,
  renderRailIcon
} from '../shell/rail-renderers.js';
export {
  renderNavigationSection,
  renderFolderIcon,
  renderNoteIcon,
  renderNoteNode,
  renderRecycleNoteNode,
  renderInlineEditorRow,
  renderDeleteIntentRow,
  renderEmptyTreeItem
} from '../navigation/tree-renderers.js';
export { renderContextMenuItems } from '../navigation/context-menu-renderers.js';
export { renderSectionMenuItems } from '../navigation/section-menu-renderers.js';

// 编辑器
export {
  renderEditorMenuBarMarkup,
  renderFileMenu,
  renderEditMenu,
  renderParagraphMenu,
  renderFormatMenu,
  renderViewMenu,
  renderMoreMenu
} from '../editor/menu-renderers.js';
export {
  renderEmptyNoteTabs,
  renderNoteTabs,
  renderTabOverflowToggle,
  renderTabOverflowMenu
} from '../editor/tab-renderers.js';
export { renderNoteTabMenuItems } from '../editor/tab-menu-renderers.js';
export {
  renderEditorContextMenuMarkup,
  renderEditorContextIconButton,
  renderEditorContextMenuItem
} from '../editor/context-menu-renderers.js';
export { renderEditorDocumentHead } from '../editor/document-head-renderer.js';
export { renderEditorPanelMarkup } from '../editor/editor-panel-renderers.js';
export { renderTableInsertDialogMarkup } from '../editor/table-dialog-renderers.js';
export { renderPreviewPane, renderSourceEditorPane } from '../editor/preview-renderers.js';
export {
  renderEmptyImageState,
  renderFilledImageState
} from '../editor/image-block-renderers.js';

// 侧边栏
export {
  renderAsideTabs,
  renderTagPills,
  renderAssignedTagPills,
  renderAvailableTagPills,
  renderLinkedNotes,
  renderAttachments
} from '../sidebar/renderers.js';

// 资料库索引
export {
  renderLibraryIndexScope,
  renderLibraryIndexContent,
  renderLibraryIndexInspector,
  renderSectionIcon
} from '../library-index/renderers.js';
export { renderLibraryPagination } from '../library-index/pagination-renderers.js';
export {
  renderLibraryIndexTabs,
  renderLibraryIndexFilters
} from '../library-index/filter-renderers.js';

// 主页与工作域
export { renderHomeWorkspace, renderHomeLoading } from '../home/renderers.js';
export {
  renderWorkDomainShell,
  renderDomainViewButton,
  renderStatusBadge,
  renderCountLabel
} from '../work-domains/renderers.js';

// 搜索
export {
  renderSearchShell,
  renderSearchPanel,
  renderSelectedSearchChips,
  renderSearchTagOption
} from '../search/renderers.js';

// 状态与标签
export {
  renderStatusIndicators,
  renderStatusFeature,
  renderStatusGlobal,
  renderStatusMeta,
  renderStatusFeatureControls
} from '../status/renderers.js';
export { renderTagList } from '../tags/inline-renderers.js';
