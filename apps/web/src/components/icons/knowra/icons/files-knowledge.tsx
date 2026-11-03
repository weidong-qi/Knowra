import { ACCENT } from "../IconBase";
import { createIcon } from "../createIcon";

export const NoteIcon = createIcon("NoteIcon", (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>
  </>
));

export const BookIcon = createIcon("BookIcon", (
  <>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2ZM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"/>
  </>
));

export const KnowledgeIcon = createIcon("KnowledgeIcon", (
  <>
    <path d="m12 3 10 5-10 5L2 8Z"/><path d="m2 12 10 5 10-5M2 16l10 5 10-5"/>
  </>
));

export const QuestionIcon = createIcon("QuestionIcon", (
  <>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M9.6 8.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .9-1 1.6"/><path d="M12 15.2h.01" strokeWidth="2.2"/>
  </>
));

export const FolderIcon = createIcon("FolderIcon", (
  <>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z"/>
  </>
));

/** 文件夹方案 05：实心前盖与半透明背板，用于侧栏文件夹树。 */
export const SolidFolderIcon = createIcon("SolidFolderIcon", (
  <>
    <path d="M3.5 7.3V6a2 2 0 0 1 2-2h4.1l2 2.3h6.9a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" fill={ACCENT} stroke="none" opacity=".48"/>
    <path d="M3.5 9a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" fill={ACCENT} stroke="none"/>
    <path d="M6 10h12" stroke="var(--surface-page, #fff)" opacity=".46" strokeWidth="1.1"/>
  </>
));

export const SolidExpandedFolderIcon = createIcon("SolidExpandedFolderIcon", (
  <>
    <path d="M3.5 7.3V6a2 2 0 0 1 2-2h4.1l2 2.3h6.9a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" fill={ACCENT} stroke="none" opacity=".48"/>
    <path d="M5.1 10h15.4a1 1 0 0 1 1 1.3l-2.1 6.8a2 2 0 0 1-1.9 1.4H6.4a1.7 1.7 0 0 1-1.7-1.4L3.4 11.8A1.5 1.5 0 0 1 5.1 10Z" fill={ACCENT} stroke="var(--surface-page, #fff)" strokeWidth=".8"/>
    <path d="M7 12h11" stroke="var(--surface-page, #fff)" opacity=".55" strokeWidth="1.1"/>
  </>
));

export const TagIcon = createIcon("TagIcon", (
  <>
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z"/><path d="M7 7h.01" strokeWidth="2.2"/>
  </>
));

export const LinkIcon = createIcon("LinkIcon", (
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>
  </>
));

export const PaperclipIcon = createIcon("PaperclipIcon", (
  <>
    <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>
  </>
));

export const StarIcon = createIcon("StarIcon", (
  <>
    <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1Z"/>
  </>
));

export const SparkIcon = createIcon("SparkIcon", (
  <>
    <path d="m11 3 1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9Z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7Z" fill={ACCENT} stroke={ACCENT} strokeWidth="1"/>
  </>
));

export const NodesIcon = createIcon("NodesIcon", (
  <>
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>
  </>
));

export const TargetIcon = createIcon("TargetIcon", (
  <>
    <circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
  </>
));

export const ClockIcon = createIcon("ClockIcon", (
  <>
    <circle cx="12" cy="12" r="9.5"/><path d="M12 6v6l4 2"/>
  </>
));

export const CalendarIcon = createIcon("CalendarIcon", (
  <>
    <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
  </>
));

export const CheckIcon = createIcon("CheckIcon", (
  <>
    <circle cx="12" cy="12" r="9.5"/><path d="m7.8 12.3 3 3 5.4-6"/>
  </>
));

export const UserIcon = createIcon("UserIcon", (
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </>
));

export const HomeIcon = createIcon("HomeIcon", (
  <>
    <rect x="3" y="3" width="7" height="18" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>
  </>
));

export const InboxIcon = createIcon("InboxIcon", (
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>
  </>
));

export const BellIcon = createIcon("BellIcon", (
  <>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
  </>
));
