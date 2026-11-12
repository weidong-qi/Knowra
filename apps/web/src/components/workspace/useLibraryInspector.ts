import { useEffect, useState } from 'react';
/** 页面布局偏好与选中身份分离；显式深链接总能展开对应详情。 */
export function useLibraryInspector(key: string, selectedId?: string | null) {
  const [open, setOpen] = useState(() => {
    try {
      return Boolean(selectedId) || localStorage.getItem(key) === 'true';
    } catch {
      return Boolean(selectedId);
    }
  });
  useEffect(() => {
    if (selectedId) setOpen(true);
  }, [selectedId]);
  useEffect(() => {
    try {
      localStorage.setItem(key, String(open));
    } catch {
      /* 会话内仍可切换。 */
    }
  }, [key, open]);
  return [open, setOpen] as const;
}
