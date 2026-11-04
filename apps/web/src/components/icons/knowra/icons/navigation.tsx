import { createIcon } from "../createIcon";

export const SearchIcon = createIcon("SearchIcon", (
  <>
    <circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>
  </>
));

export const PlusIcon = createIcon("PlusIcon", (
  <>
    <path d="M12 5v14M5 12h14"/>
  </>
));

export const FilterIcon = createIcon("FilterIcon", (
  <>
    <path d="M22 3H2l8 9.5V19l4 2v-8.5Z"/>
  </>
));

/** 筛选：由长到短的三条线，与原型工具栏一致。 */
export const FilterLinesIcon = createIcon("FilterLinesIcon", (
  <>
    <path d="M3 5h18M6 12h12M10 19h4"/>
  </>
));

/** 显示选项：两条水平滑杆。 */
export const DisplayOptionsIcon = createIcon("DisplayOptionsIcon", (
  <>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10"/>
    <circle cx="16" cy="7" r="2"/>
    <circle cx="8" cy="17" r="2"/>
  </>
));

export const ChevronLeftIcon = createIcon("ChevronLeftIcon", (
  <>
    <path d="m15 6-6 6 6 6"/>
  </>
));

export const SettingsIcon = createIcon("SettingsIcon", (
  <>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 16V3M1 14h6M9 8h6M17 16h6"/>
  </>
));

export const ArrowRightIcon = createIcon("ArrowRightIcon", (
  <>
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </>
));

export const ChevronRightIcon = createIcon("ChevronRightIcon", (
  <>
    <path d="m9 18 6-6-6-6"/>
  </>
));

export const ChevronDownIcon = createIcon("ChevronDownIcon", (
  <>
    <path d="m6 9 6 6 6-6"/>
  </>
));

export const CloseIcon = createIcon("CloseIcon", (
  <>
    <path d="M18 6 6 18M6 6l12 12"/>
  </>
));

export const ArrowUpRightIcon = createIcon("ArrowUpRightIcon", (
  <>
    <path d="M7 17 17 7M7 7h10v10"/>
  </>
));

export const RefreshIcon = createIcon("RefreshIcon", (
  <>
    <path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>
  </>
));

export const UploadIcon = createIcon("UploadIcon", (
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>
  </>
));

export const SortArrowsIcon = createIcon("SortArrowsIcon", (
  <>
    <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>
  </>
));

export const SidebarIcon = createIcon("SidebarIcon", (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>
  </>
));

export const PanelIcon = createIcon("PanelIcon", (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>
  </>
));

export const FocusIcon = createIcon("FocusIcon", (
  <>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
  </>
));

export const ComponentLibraryIcon = createIcon("ComponentLibraryIcon", (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>
  </>
));

export const MoreHorizontalIcon = createIcon("MoreHorizontalIcon", (
  <>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>
  </>
));

export const MoreVerticalIcon = createIcon("MoreVerticalIcon", (
  <>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>
  </>
));
