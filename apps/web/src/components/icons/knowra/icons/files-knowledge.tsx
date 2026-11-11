import { createIcon } from '../createIcon';
import { Fit, OWN_STROKE } from './fit';

/** 笔记：折角纸页加两道线，单色。 */
export const NoteIcon = createIcon(
  'NoteIcon',
  <Fit>
    <path d="M7.2 4.4h6.2l4.4 4.4v10.2a1.7 1.7 0 0 1-1.7 1.7H7.2a1.7 1.7 0 0 1-1.7-1.7V6.1a1.7 1.7 0 0 1 1.7-1.7Z" />
    <path d="M13.4 4.4v4.4h4.4" />
    <path d="M8.8 13.4h6" />
    <path d="M8.8 16.8h3.4" />
  </Fit>,
  OWN_STROKE
);

export const BookIcon = createIcon(
  'BookIcon',
  <>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2ZM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z" />
  </>
);

/** 知识：向右上错位叠放的三张卡片，单色。 */
export const KnowledgeIcon = createIcon(
  'KnowledgeIcon',
  <Fit>
    <rect x="3.8" y="9" width="12.8" height="11.2" rx="2.2" />
    <path d="M7.2 6.2h10.2a2.1 2.1 0 0 1 2.1 2.1v9.6" opacity=".6" />
    <path d="M10.6 3.6h7.6a2.1 2.1 0 0 1 2.1 2.1v4" opacity=".35" />
    <path d="M7 14.6h6.2" />
  </Fit>,
  OWN_STROKE
);

export const QuestionIcon = createIcon(
  'QuestionIcon',
  <>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    <path d="M9.6 8.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .9-1 1.6" />
    <path d="M12 15.2h.01" strokeWidth="2.2" />
  </>
);

/** 文件夹：圆角线框，单色。 */
export const FolderIcon = createIcon(
  'FolderIcon',
  <Fit>
    <path d="M4 7.4A1.8 1.8 0 0 1 5.8 5.6h3.8l1.9 2.1h6.7A1.8 1.8 0 0 1 20 9.5v8.1a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.6Z" />
    <path d="M4 11.5h16" strokeWidth={1.2} opacity=".7" />
  </Fit>,
  OWN_STROKE
);

/** 文件夹方案 05：实心前盖与半透明背板，用于侧栏文件夹树。 */
/** 侧栏树与列表里的文件夹：黑色线框（不再是橙色实心）。 */
export const SolidFolderIcon = createIcon(
  'SolidFolderIcon',
  <Fit>
    <path d="M4 7.4A1.8 1.8 0 0 1 5.8 5.6h3.8l1.9 2.1h6.7A1.8 1.8 0 0 1 20 9.5v8.1a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.6Z" />
  </Fit>,
  OWN_STROKE
);

/** 侧栏未选中的闭合文件夹：整体外形 + 一条前板分界线（候选 02）。 */
export const SidebarClosedFolderIcon = createIcon(
  'SidebarClosedFolderIcon',
  <Fit>
    <path d="M4 7.4A1.8 1.8 0 0 1 5.8 5.6h3.8l1.9 2.1h6.7A1.8 1.8 0 0 1 20 9.5v8.1a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.6Z" />
    <path d="M4 11.5h16" strokeWidth={1.2} opacity=".7" />
  </Fit>,
  OWN_STROKE
);

export const SolidExpandedFolderIcon = createIcon(
  'SolidExpandedFolderIcon',
  <Fit>
    <path d="M4 17.6V7.4A1.8 1.8 0 0 1 5.8 5.6h3.8l1.9 2.1h6.7A1.8 1.8 0 0 1 20 9.5v1.4" opacity=".55" />
    <path d="M4 17.6l2-5.9A1.8 1.8 0 0 1 7.7 10.5h12.9a1.1 1.1 0 0 1 1.04 1.46l-1.9 5.5a1.8 1.8 0 0 1-1.7 1.2H5.8A1.8 1.8 0 0 1 4 17.6Z" />
  </Fit>,
  OWN_STROKE
);

export const TagIcon = createIcon(
  'TagIcon',
  <Fit>
    <path d="M4.2 6A1.8 1.8 0 0 1 6 4.2h5.4a1.8 1.8 0 0 1 1.27.53l7 7a1.8 1.8 0 0 1 0 2.54l-5.4 5.4a1.8 1.8 0 0 1-2.54 0l-7-7A1.8 1.8 0 0 1 4.2 11.4Z" />
    <circle cx="8.3" cy="8.3" r="1.4" fill="currentColor" stroke="none" />
  </Fit>,
  OWN_STROKE
);

export const LinkIcon = createIcon(
  'LinkIcon',
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>
);

export const PaperclipIcon = createIcon(
  'PaperclipIcon',
  <>
    <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
  </>
);

export const StarIcon = createIcon(
  'StarIcon',
  <>
    <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1Z" />
  </>
);

/** AI 助手：带两只眼睛和微笑的对话框，替代原来的四角星。 */
export const SparkIcon = createIcon(
  'SparkIcon',
  <Fit>
    <path d="M6 4.4h12a2.4 2.4 0 0 1 2.4 2.4v8.2a2.4 2.4 0 0 1-2.4 2.4h-6.6L7 21.2v-3.8H6A2.4 2.4 0 0 1 3.6 15V6.8A2.4 2.4 0 0 1 6 4.4Z" />
    <circle cx="9.2" cy="10" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="10" r="1.05" fill="currentColor" stroke="none" />
    <path d="M10 12.9q2 1.7 4 0" />
  </Fit>,
  OWN_STROKE
);

export const NodesIcon = createIcon(
  'NodesIcon',
  <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </>
);

export const TargetIcon = createIcon(
  'TargetIcon',
  <>
    <circle cx="12" cy="12" r="9.5" />
    <circle cx="12" cy="12" r="5.5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </>
);

export const ClockIcon = createIcon(
  'ClockIcon',
  <>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 6v6l4 2" />
  </>
);

export const CalendarIcon = createIcon(
  'CalendarIcon',
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </>
);

export const CheckIcon = createIcon(
  'CheckIcon',
  <>
    <circle cx="12" cy="12" r="9.5" />
    <path d="m7.8 12.3 3 3 5.4-6" />
  </>
);

export const UserIcon = createIcon(
  'UserIcon',
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);

export const HomeIcon = createIcon(
  'HomeIcon',
  <>
    <rect x="3" y="3" width="7" height="18" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </>
);

export const InboxIcon = createIcon(
  'InboxIcon',
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  </>
);

export const BellIcon = createIcon(
  'BellIcon',
  <>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </>
);
