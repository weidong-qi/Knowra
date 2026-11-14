import { ACCENT } from "../IconBase";
import { createIcon } from "../createIcon";

export const NoteIcon = createIcon("NoteIcon", (
  <>
    <path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4"/><path d="M9 12h6M9 15h6M9 18h4"/><path d="M19.5 8.5v12H8" stroke={ACCENT}/>
  </>
));

export const BookIcon = createIcon("BookIcon", (
  <>
    <path d="M4 5.5c2.8-.8 5.5-.4 8 1.2v13c-2.5-1.6-5.2-2-8-1.2z"/><path d="M20 5.5c-2.8-.8-5.5-.4-8 1.2v13c2.5-1.6 5.2-2 8-1.2z"/><path d="M12 6.7v13" stroke={ACCENT}/>
  </>
));

export const QuestionIcon = createIcon("QuestionIcon", (
  <>
    <path d="M5 4.5h14v11H11l-4 3v-3H5z"/><path d="M10 8.5a2.2 2.2 0 1 1 3.3 1.9c-.8.5-1.3.9-1.3 1.9"/><path d="M12 14.1h.01" stroke={ACCENT} strokeWidth="2.5"/>
  </>
));

export const FolderIcon = createIcon("FolderIcon", (
  <>
    <path d="M3 6h7l2 2h9v11H3z"/><path d="M3 8h18"/><path d="M7 19h11" stroke={ACCENT}/>
  </>
));

export const TagIcon = createIcon("TagIcon", (
  <>
    <path d="M4 9V4h5l10 10-5 5z"/><circle cx="7.5" cy="7.5" r="1.2" fill={ACCENT} stroke="none"/>
  </>
));

export const LinkIcon = createIcon("LinkIcon", (
  <>
    <path d="M9.5 14.5 8 16a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0"/><path d="m14.5 9.5 1.5-1.5a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/><path d="m9 15 6-6" stroke={ACCENT}/>
  </>
));

export const PaperclipIcon = createIcon("PaperclipIcon", (
  <>
    <path d="m8 12.5 6.8-6.8a3 3 0 1 1 4.2 4.2l-8.5 8.5a4.5 4.5 0 0 1-6.4-6.4l8.2-8.2"/><path d="m9.5 13.8 6.6-6.6" stroke={ACCENT}/>
  </>
));

export const StarIcon = createIcon("StarIcon", (
  <>
    <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/><path d="m12 7.5 1.4 2.8 3.1.5-2.2 2.2.5 3.1-2.8-1.5-2.8 1.5.5-3.1-2.2-2.2 3.1-.5z" stroke={ACCENT}/>
  </>
));

export const SparkIcon = createIcon("SparkIcon", (
  <>
    <path d="M12 3c.6 4 2.6 6 6.5 6.5C14.6 10 12.6 12 12 16c-.6-4-2.6-6-6.5-6.5C9.4 9 11.4 7 12 3Z" fill={ACCENT} stroke="none"/><path d="M19 15c.2 1.7 1.1 2.6 2.8 2.8-1.7.2-2.6 1.1-2.8 2.8-.2-1.7-1.1-2.6-2.8-2.8 1.7-.2 2.6-1.1 2.8-2.8Z" fill="currentColor" stroke="none"/>
  </>
));

export const NodesIcon = createIcon("NodesIcon", (
  <>
    <circle cx="12" cy="5" r="2.2" fill={ACCENT}/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M10.9 6.9 6.2 16M13.1 6.9l4.7 9.1M7.2 18h9.6"/>
  </>
));

export const TargetIcon = createIcon("TargetIcon", (
  <>
    <circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.8" fill={ACCENT} stroke={ACCENT}/>
  </>
));

export const ClockIcon = createIcon("ClockIcon", (
  <>
    <circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.7 2.2" stroke={ACCENT}/>
  </>
));

export const CalendarIcon = createIcon("CalendarIcon", (
  <>
    <path d="M4 6.5h16v13H4z"/><path d="M7 3.5v6M17 3.5v6M4 10h16"/><rect x="7" y="13" width="3" height="3" fill={ACCENT} stroke="none"/><rect x="12" y="13" width="3" height="3" fill={ACCENT} stroke="none"/>
  </>
));

export const CheckIcon = createIcon("CheckIcon", (
  <>
    <circle cx="12" cy="12" r="8.5"/><path d="m8 12.2 2.6 2.6 5.6-6" stroke={ACCENT} strokeWidth="2.2"/>
  </>
));

export const UserIcon = createIcon("UserIcon", (
  <>
    <circle cx="12" cy="8" r="3.2" fill={ACCENT}/><path d="M5.5 20c.4-4.2 2.7-6.3 6.5-6.3s6.1 2.1 6.5 6.3"/>
  </>
));

export const HomeIcon = createIcon("HomeIcon", (
  <>
    <path d="m3.5 11 8.5-7 8.5 7v9H3.5z"/><path d="M9.5 20v-6h5v6" stroke={ACCENT}/>
  </>
));

export const BellIcon = createIcon("BellIcon", (
  <>
    <path d="M6 17h12l-1.4-2.2V10a4.6 4.6 0 0 0-9.2 0v4.8z"/><path d="M10 20h4"/><circle cx="18.5" cy="6" r="1.7" fill={ACCENT} stroke="none"/>
  </>
));
