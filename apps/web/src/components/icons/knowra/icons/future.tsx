import { createIcon } from "../createIcon";

export const ExpandedFolderIcon = createIcon("ExpandedFolderIcon", (
  <>
    <path d="M5 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h7a2 2 0 0 1 2 2v2"/><path d="m3 19 2.6-8a1.8 1.8 0 0 1 1.7-1.2H21a1 1 0 0 1 1 1.3L19.8 18.3a2 2 0 0 1-1.9 1.7H5a2 2 0 0 1-2-1Z"/>
  </>
));

export const MarkdownFileIcon = createIcon("MarkdownFileIcon", (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8.8 17.5v-5l2.7 3 2.7-3v5"/>
  </>
));

export const PdfFileIcon = createIcon("PdfFileIcon", (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 18v-6h2.6a1.9 1.9 0 0 1 0 3.8H9"/>
  </>
));

export const ResourceFileIcon = createIcon("ResourceFileIcon", (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8.5 13h7M8.5 17h7"/>
  </>
));

export const DuplicateIcon = createIcon("DuplicateIcon", (
  <>
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><path d="M15.5 12.5v6M12.5 15.5h6"/>
  </>
));

export const DownloadIcon = createIcon("DownloadIcon", (
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>
  </>
));

export const ExportIcon = createIcon("ExportIcon", (
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>
  </>
));

export const BackupIcon = createIcon("BackupIcon", (
  <>
    <ellipse cx="10" cy="5" rx="7" ry="3"/><path d="M3 5v14c0 1.7 3.1 3 7 3M17 5v4M3 12c0 1.7 3.1 3 7 3"/><circle cx="18" cy="17" r="4.5"/><path d="M18 14.8V17l1.6 1"/>
  </>
));

export const RestoreIcon = createIcon("RestoreIcon", (
  <>
    <path d="M1 4v6h6"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/><path d="M12 8v4l3 2"/>
  </>
));

export const UndoIcon = createIcon("UndoIcon", (
  <>
    <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
  </>
));

export const RedoIcon = createIcon("RedoIcon", (
  <>
    <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
  </>
));
