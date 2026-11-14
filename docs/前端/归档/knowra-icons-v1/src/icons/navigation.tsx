import { ACCENT } from "../IconBase";
import { createIcon } from "../createIcon";

export const SearchIcon = createIcon("SearchIcon", (
  <>
    <circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 5 5" stroke={ACCENT} strokeWidth="2.1"/>
  </>
));

export const PlusIcon = createIcon("PlusIcon", (
  <>
    <path d="M12 4v16M4 12h16"/>
  </>
));

export const FilterIcon = createIcon("FilterIcon", (
  <>
    <path d="M4 5h16l-6.3 7.2V19l-3.4 1v-7.8z"/><path d="M6.5 7h11" stroke={ACCENT}/>
  </>
));

export const SettingsIcon = createIcon("SettingsIcon", (
  <>
    <circle cx="12" cy="12" r="3" fill={ACCENT}/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"/><circle cx="12" cy="12" r="7.1"/>
  </>
));

export const ArrowRightIcon = createIcon("ArrowRightIcon", (
  <>
    <path d="M4 12h15M14 7l5 5-5 5"/>
  </>
));

export const ChevronRightIcon = createIcon("ChevronRightIcon", (
  <>
    <path d="m9 5 7 7-7 7"/>
  </>
));

export const ChevronDownIcon = createIcon("ChevronDownIcon", (
  <>
    <path d="m5 9 7 7 7-7"/>
  </>
));

export const CloseIcon = createIcon("CloseIcon", (
  <>
    <path d="M5 5l14 14M19 5 5 19"/>
  </>
));

export const ArrowUpRightIcon = createIcon("ArrowUpRightIcon", (
  <>
    <path d="M7 17 17 7M10 7h7v7"/>
  </>
));

export const RefreshIcon = createIcon("RefreshIcon", (
  <>
    <path d="M19 8a7.5 7.5 0 0 0-12.7-2L4 8"/><path d="M4 4v4h4" stroke={ACCENT}/><path d="M5 16a7.5 7.5 0 0 0 12.7 2L20 16"/><path d="M20 20v-4h-4" stroke={ACCENT}/>
  </>
));

export const UploadIcon = createIcon("UploadIcon", (
  <>
    <path d="M12 16V4M8 8l4-4 4 4" stroke={ACCENT}/><path d="M5 14v6h14v-6"/>
  </>
));

export const SortArrowsIcon = createIcon("SortArrowsIcon", (
  <>
    <path d="M8 5v14M5 8l3-3 3 3"/><path d="M16 19V5M13 16l3 3 3-3" stroke={ACCENT}/>
  </>
));

export const SidebarIcon = createIcon("SidebarIcon", (
  <>
    <rect x="3.5" y="4" width="17" height="16"/><path d="M8.5 4v16"/><path d="M5.5 8h1" stroke={ACCENT} strokeWidth="2"/>
  </>
));

export const PanelIcon = createIcon("PanelIcon", (
  <>
    <rect x="3.5" y="4" width="17" height="16"/><path d="M15.5 4v16"/><path d="M17.5 8h1" stroke={ACCENT} strokeWidth="2"/>
  </>
));

export const FocusIcon = createIcon("FocusIcon", (
  <>
    <path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/><circle cx="12" cy="12" r="2" fill={ACCENT} stroke="none"/>
  </>
));

export const ComponentLibraryIcon = createIcon("ComponentLibraryIcon", (
  <>
    <rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6" fill={ACCENT} stroke={ACCENT}/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>
  </>
));

export const MoreHorizontalIcon = createIcon("MoreHorizontalIcon", (
  <>
    <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>
  </>
));

export const MoreVerticalIcon = createIcon("MoreVerticalIcon", (
  <>
    <circle cx="12" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none"/>
  </>
));
