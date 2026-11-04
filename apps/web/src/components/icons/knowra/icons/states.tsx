import { createIcon } from "../createIcon";

export const DropdownArrowIcon = createIcon("DropdownArrowIcon", (
  <>
    <path d="m6 9 6 6 6-6"/>
  </>
));

export const TreeExpandIcon = createIcon("TreeExpandIcon", (
  <>
    <path d="m9 18 6-6-6-6"/>
  </>
));

export const SearchClearIcon = createIcon("SearchClearIcon", (
  <>
    <circle cx="12" cy="12" r="9.5"/><path d="m15 9-6 6M9 9l6 6"/>
  </>
));

export const DialogCloseIcon = createIcon("DialogCloseIcon", (
  <>
    <path d="M18 6 6 18M6 6l12 12"/>
  </>
));

export const CheckboxCheckedIcon = createIcon("CheckboxCheckedIcon", (
  <>
    <rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>
  </>
));

export const CheckboxIndeterminateIcon = createIcon("CheckboxIndeterminateIcon", (
  <>
    <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8"/>
  </>
));

export const TagSelectedCheckIcon = createIcon("TagSelectedCheckIcon", (
  <>
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z"/><path d="m8.8 12 2.2 2.2 4-4"/>
  </>
));

export const TagRemoveIcon = createIcon("TagRemoveIcon", (
  <>
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/>
  </>
));

export const StatusDotIcon = createIcon("StatusDotIcon", (
  <>
    <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/>
  </>
));

/** 虚线圆环：筛选里的“状态”维度。 */
export const StatusRingIcon = createIcon("StatusRingIcon", (
  <>
    <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3.2"/>
  </>
));
