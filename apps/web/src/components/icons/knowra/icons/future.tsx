import { createIcon } from "../createIcon";
import { Fit, OWN_STROKE } from "./fit";

export const ExpandedFolderIcon = createIcon("ExpandedFolderIcon", (
  <Fit>
    <path d="M4 17.6V7.4A1.8 1.8 0 0 1 5.8 5.6h3.8l1.9 2.1h6.7A1.8 1.8 0 0 1 20 9.5v1.4" opacity=".55"/><path d="M4 17.6l2-5.9A1.8 1.8 0 0 1 7.7 10.5h12.9a1.1 1.1 0 0 1 1.04 1.46l-1.9 5.5a1.8 1.8 0 0 1-1.7 1.2H5.8A1.8 1.8 0 0 1 4 17.6Z"/>
  </Fit>
), OWN_STROKE);

export const MarkdownFileIcon = createIcon("MarkdownFileIcon", (
  <Fit>
    <path d="M7.2 4.4h6.2l4.4 4.4v10.2a1.7 1.7 0 0 1-1.7 1.7H7.2a1.7 1.7 0 0 1-1.7-1.7V6.1a1.7 1.7 0 0 1 1.7-1.7Z"/><path d="M13.4 4.4v4.4h4.4"/><path d="M10.3 12l-.7 5.4M13.7 12l-.7 5.4M8.4 13.7h6.6M8 15.9h6.6"/>
  </Fit>
), OWN_STROKE);

export const PdfFileIcon = createIcon("PdfFileIcon", (
  <Fit>
    <path d="M7.2 4.4h6.2l4.4 4.4v10.2a1.7 1.7 0 0 1-1.7 1.7H7.2a1.7 1.7 0 0 1-1.7-1.7V6.1a1.7 1.7 0 0 1 1.7-1.7Z"/><path d="M13.4 4.4v4.4h4.4"/><rect x="7.4" y="11.4" width="8.8" height="4.2" rx="1.1" fill="currentColor" stroke="none"/><path d="M8.8 18.4h5"/>
  </Fit>
), OWN_STROKE);

export const ResourceFileIcon = createIcon("ResourceFileIcon", (
  <Fit>
    <path d="M7.2 4.4h6.2l4.4 4.4v10.2a1.7 1.7 0 0 1-1.7 1.7H7.2a1.7 1.7 0 0 1-1.7-1.7V6.1a1.7 1.7 0 0 1 1.7-1.7Z"/><path d="M13.4 4.4v4.4h4.4"/><path d="M8.8 12.6h6.4M8.8 15.4h6.4M8.8 18.2h3"/>
  </Fit>
), OWN_STROKE);

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
