import { ACCENT } from "../IconBase";
import { createIcon } from "../createIcon";

export const DropdownArrowIcon = createIcon("DropdownArrowIcon", (
  <>
    <path d="m6 9 6 6 6-6"/>
  </>
));

export const TreeExpandIcon = createIcon("TreeExpandIcon", (
  <>
    <path d="m9 5 7 7-7 7"/>
  </>
));

export const SearchClearIcon = createIcon("SearchClearIcon", (
  <>
    <circle cx="10" cy="10" r="5.5"/><path d="m14.2 14.2 4.5 4.5"/><path d="m17 6 4 4M21 6l-4 4" stroke={ACCENT}/>
  </>
));

export const DialogCloseIcon = createIcon("DialogCloseIcon", (
  <>
    <path d="M6 6l12 12M18 6 6 18"/>
  </>
));

export const CheckboxCheckedIcon = createIcon("CheckboxCheckedIcon", (
  <>
    <rect x="4" y="4" width="16" height="16"/><path d="m7.5 12 3 3 6-7" stroke={ACCENT} strokeWidth="2.2"/>
  </>
));

export const CheckboxIndeterminateIcon = createIcon("CheckboxIndeterminateIcon", (
  <>
    <rect x="4" y="4" width="16" height="16"/><path d="M8 12h8" stroke={ACCENT} strokeWidth="2.2"/>
  </>
));

export const TagSelectedCheckIcon = createIcon("TagSelectedCheckIcon", (
  <>
    <path d="M4 9V4h5l10 10-5 5z"/><path d="m9 12 2 2 4-4" stroke={ACCENT} strokeWidth="2"/>
  </>
));

export const TagRemoveIcon = createIcon("TagRemoveIcon", (
  <>
    <path d="M4 9V4h5l10 10-5 5z"/><path d="m11.5 10.5 4 4M15.5 10.5l-4 4" stroke={ACCENT}/>
  </>
));

export const StatusDotIcon = createIcon("StatusDotIcon", (
  <>
    <circle cx="12" cy="12" r="4" fill={ACCENT} stroke="none"/>
  </>
));
