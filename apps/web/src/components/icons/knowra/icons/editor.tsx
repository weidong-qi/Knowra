import { forwardRef } from "react";
import { IconBase } from "../IconBase";
import { createIcon } from "../createIcon";
import type { KnowraIconProps } from "../types";

export const CodeIcon = createIcon("CodeIcon", (
  <>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>
  </>
));

export const ListIcon = createIcon("ListIcon", (
  <>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </>
));

export const OrderedListIcon = createIcon("OrderedListIcon", (
  <>
    <path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>
  </>
));

export const TaskListIcon = createIcon("TaskListIcon", (
  <>
    <path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 7h8M13 17h8"/>
  </>
));

export const QuoteIcon = createIcon("QuoteIcon", (
  <>
    <path d="M7 17c2.5 0 4-1.5 4-4V8H5.5v5H8M17 17c2.5 0 4-1.5 4-4V8h-5.5v5H18"/>
  </>
));

export const TableIcon = createIcon("TableIcon", (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>
  </>
));

export const ImageIcon = createIcon("ImageIcon", (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
  </>
));

export const BoldIcon = createIcon("BoldIcon", (
  <>
    <path d="M6 4h8a4 4 0 0 1 0 8H6ZM6 12h9a4 4 0 0 1 0 8H6Z"/>
  </>
), 2);

export const ItalicIcon = createIcon("ItalicIcon", (
  <>
    <path d="M19 4h-9M14 20H5M15 4 9 20"/>
  </>
), 1.9);

export const HighlightIcon = createIcon("HighlightIcon", (
  <>
    <path d="m9 11-5 5v4h4l5-5"/><path d="m21 9-5 5-5-5 5-5Z"/><path d="M4 20.5h16"/>
  </>
));

export const StrikethroughIcon = createIcon("StrikethroughIcon", (
  <>
    <path d="M16 4H9.5a3.5 3.5 0 0 0-3.4 4.3M14.5 12a4 4 0 0 1 0 8H6M4 12h16"/>
  </>
));

export const CutIcon = createIcon("CutIcon", (
  <>
    <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>
  </>
));

export const CopyIcon = createIcon("CopyIcon", (
  <>
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </>
));

export const PasteIcon = createIcon("PasteIcon", (
  <>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>
  </>
));

export const DeleteIcon = createIcon("DeleteIcon", (
  <>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
  </>
));

export const EditIcon = createIcon("EditIcon", (
  <>
    <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
  </>
));

export const IndentIcon = createIcon("IndentIcon", (
  <>
    <path d="M3 5h18M11 12h10M3 19h18M3 9l3 3-3 3"/>
  </>
));

export const OutdentIcon = createIcon("OutdentIcon", (
  <>
    <path d="M3 5h18M11 12h10M3 19h18M7 9l-3 3 3 3"/>
  </>
));

export const HorizontalRuleIcon = createIcon("HorizontalRuleIcon", (
  <>
    <path d="M3 12h18"/>
  </>
));

export const ParagraphAddIcon = forwardRef<SVGSVGElement, KnowraIconProps & { position?: "above" | "below" }>(
  function ParagraphAddIcon({ position = "below", ...props }, ref) {
    return <IconBase ref={ref} {...props}>
      {position === "above"
        ? <path d="M4 18h16M4 12h10M4 6h5M17 3v6M14 6h6" />
        : <path d="M4 6h16M4 12h10M4 18h5M17 15v6M14 18h6" />}
    </IconBase>;
  }
);
