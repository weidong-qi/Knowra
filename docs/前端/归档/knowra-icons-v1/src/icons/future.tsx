import { ACCENT } from "../IconBase";
import { createIcon } from "../createIcon";

export const ExpandedFolderIcon = createIcon("ExpandedFolderIcon", (
  <>
    <path d="M3 7h7l2 2h9v2"/><path d="M4 11h17l-2 9H3z"/><path d="m16 14 2 2 2-2" stroke={ACCENT}/>
  </>
));

export const MarkdownFileIcon = createIcon("MarkdownFileIcon", (
  <>
    <path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4"/><path d="M8.5 14v-4l2 2 2-2v4M15 10v4M13.8 12.8 15 14l1.2-1.2" stroke={ACCENT}/>
  </>
));

export const PdfFileIcon = createIcon("PdfFileIcon", (
  <>
    <path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4"/><path d="M8.5 15c2.5-4.5 4.2-6.5 5.2-5.2 1.2 1.5-1.9 5.8-4.2 4.3-1.2-.8 1.4-2 5-1.5 1.5.2 2.3.7 2.7 1.1" stroke={ACCENT}/>
  </>
));

export const ResourceFileIcon = createIcon("ResourceFileIcon", (
  <>
    <path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4"/><path d="M9 12h2M13 12h2M9 16h6"/><path d="m10 8.5 1.5 1.5L14 7.5" stroke={ACCENT}/>
  </>
));

export const DuplicateIcon = createIcon("DuplicateIcon", (
  <>
    <rect x="7" y="5" width="12" height="15"/><path d="M5 17H3V3h12v2"/><path d="M11 9h4M13 7v4" stroke={ACCENT}/>
  </>
));

export const DownloadIcon = createIcon("DownloadIcon", (
  <>
    <path d="M12 4v12M8 12l4 4 4-4" stroke={ACCENT}/><path d="M5 18v2h14v-2"/>
  </>
));

export const ExportIcon = createIcon("ExportIcon", (
  <>
    <path d="M13 5H5v14h14v-8"/><path d="M12 12 20 4M15 4h5v5" stroke={ACCENT}/>
  </>
));

export const BackupIcon = createIcon("BackupIcon", (
  <>
    <ellipse cx="10" cy="6" rx="5" ry="2.5"/><path d="M5 6v8c0 1.4 2.2 2.5 5 2.5.7 0 1.4-.1 2-.2M15 6v5"/><circle cx="17" cy="16" r="4"/><path d="M17 13.5V16l1.8 1.1" stroke={ACCENT}/>
  </>
));

export const RestoreIcon = createIcon("RestoreIcon", (
  <>
    <path d="M6 8a7 7 0 1 1-1 7"/><path d="M6 4v4h4" stroke={ACCENT}/><path d="M12 8v4l-3 2"/>
  </>
));

export const UndoIcon = createIcon("UndoIcon", (
  <>
    <path d="M9 7 4 12l5 5" stroke={ACCENT}/><path d="M5 12h7c4 0 7 2 7 6"/>
  </>
));

export const RedoIcon = createIcon("RedoIcon", (
  <>
    <path d="m15 7 5 5-5 5" stroke={ACCENT}/><path d="M19 12h-7c-4 0-7 2-7 6"/>
  </>
));
