import { ACCENT } from "../IconBase";
import { createIcon } from "../createIcon";

export const CodeIcon = createIcon("CodeIcon", (
  <>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5"/><path d="m14 4-4 16" stroke={ACCENT}/>
  </>
));

export const ListIcon = createIcon("ListIcon", (
  <>
    <circle cx="5" cy="7" r="1.1" fill={ACCENT} stroke="none"/><circle cx="5" cy="12" r="1.1" fill={ACCENT} stroke="none"/><circle cx="5" cy="17" r="1.1" fill={ACCENT} stroke="none"/><path d="M9 7h11M9 12h11M9 17h11"/>
  </>
));

export const OrderedListIcon = createIcon("OrderedListIcon", (
  <>
    <path d="M4 6h2v4M4 10h3M4 14h2.2c.8 0 1.2.4 1.2 1 0 1-3.4 2.1-3.4 4h3.5" stroke={ACCENT}/><path d="M10 7h10M10 12h10M10 17h10"/>
  </>
));

export const TaskListIcon = createIcon("TaskListIcon", (
  <>
    <rect x="4" y="5" width="4" height="4"/><path d="m5 7 1 1 2-3" stroke={ACCENT}/><rect x="4" y="15" width="4" height="4"/><path d="M11 7h9M11 17h9"/>
  </>
));

export const QuoteIcon = createIcon("QuoteIcon", (
  <>
    <path d="M5 8h5v5H6c0 2-1 3.5-3 4.5M14 8h5v5h-4c0 2-1 3.5-3 4.5" fill={ACCENT} stroke={ACCENT}/>
  </>
));

export const TableIcon = createIcon("TableIcon", (
  <>
    <rect x="3.5" y="4" width="17" height="16"/><path d="M3.5 9h17M9 4v16M15 4v16M3.5 14h17"/><rect x="3.5" y="4" width="5.5" height="5" fill={ACCENT} stroke="none" opacity=".9"/>
  </>
));

export const ImageIcon = createIcon("ImageIcon", (
  <>
    <rect x="4" y="4" width="16" height="16"/><circle cx="15.5" cy="8.5" r="1.5" fill={ACCENT} stroke="none"/><path d="m6 17 4.5-5 3.3 3.5 2.2-2.2 2 3.7"/>
  </>
));

export const BoldIcon = createIcon("BoldIcon", (
  <>
    <path d="M8 4h5a4 4 0 0 1 0 8H8zM8 12h5.8a4 4 0 0 1 0 8H8z" strokeWidth="2"/>
  </>
));

export const ItalicIcon = createIcon("ItalicIcon", (
  <>
    <path d="M10 4h7M7 20h7M14 4 10 20" strokeWidth="2"/>
  </>
));

export const HighlightIcon = createIcon("HighlightIcon", (
  <>
    <path d="m7 16 8-10 3 2.5-8 10H7z"/><path d="M5 20h14" stroke={ACCENT} strokeWidth="2.5"/>
  </>
));

export const StrikethroughIcon = createIcon("StrikethroughIcon", (
  <>
    <path d="M16 6.5c-1-1-2.3-1.5-4-1.5-2.1 0-3.5 1-3.5 2.6 0 1.3 1 2.1 3.2 2.7M8.2 16.5c.9 1 2.2 1.5 4 1.5 2.3 0 3.8-1 3.8-2.7 0-1.5-1-2.2-3.5-2.8"/><path d="M5 12h14" stroke={ACCENT} strokeWidth="2"/>
  </>
));

export const CutIcon = createIcon("CutIcon", (
  <>
    <circle cx="6" cy="17" r="2.2"/><circle cx="6" cy="7" r="2.2"/><path d="m8 8 11 8M8 16 19 8"/><path d="m13.5 12 5.5 4" stroke={ACCENT}/>
  </>
));

export const CopyIcon = createIcon("CopyIcon", (
  <>
    <rect x="8" y="7" width="11" height="13"/><path d="M5 17H4V4h11v1"/><path d="M15 7h4v4" stroke={ACCENT}/>
  </>
));

export const PasteIcon = createIcon("PasteIcon", (
  <>
    <path d="M8 5h8v3H8z" fill={ACCENT} stroke={ACCENT}/><path d="M6 7H4v14h16V7h-2"/>
  </>
));

export const DeleteIcon = createIcon("DeleteIcon", (
  <>
    <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 10v7M14 10v7" stroke={ACCENT}/>
  </>
));

export const EditIcon = createIcon("EditIcon", (
  <>
    <path d="m5 19 4-.8L19 8.2 15.8 5 5.8 15z"/><path d="m14.5 6.3 3.2 3.2" stroke={ACCENT}/>
  </>
));

export const IndentIcon = createIcon("IndentIcon", (
  <>
    <path d="M10 7h10M10 12h10M10 17h10"/><path d="m4 8 4 4-4 4" stroke={ACCENT}/>
  </>
));

export const OutdentIcon = createIcon("OutdentIcon", (
  <>
    <path d="M10 7h10M10 12h10M10 17h10"/><path d="m8 8-4 4 4 4" stroke={ACCENT}/>
  </>
));

export const HorizontalRuleIcon = createIcon("HorizontalRuleIcon", (
  <>
    <path d="M4 12h16"/>
  </>
));

export const ParagraphAddIcon = createIcon("ParagraphAddIcon", (
  <>
    <path d="M5 5h8a4 4 0 0 1 0 8H9V5M9 5v14"/><path d="M16 17h5M18.5 14.5v5" stroke={ACCENT}/>
  </>
));
