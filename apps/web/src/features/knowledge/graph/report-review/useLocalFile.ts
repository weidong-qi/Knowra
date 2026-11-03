import { useCallback, useEffect, useRef, useState } from 'react';

/** 文件只在内存读取。每次意图（包括取消、重置、关闭）让旧读取失效。 */
export function useLocalFile<T>(parse: (text: string) => T, maxBytes: number, onLoaded: (value: T) => void) {
  const generation = useRef(0);
  const active = useRef(true);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invalidate = useCallback(() => { generation.current++; setBusy(false); setError(''); }, []);
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const read = async (file?: File) => {
    const ticket = ++generation.current;
    setError(''); setBusy(false);
    if (!file) return;
    if (file.size > maxBytes) { setError('文件过大，未读取。请选择符合离线审阅上限的 JSON 文件。'); return; }
    setBusy(true);
    try {
      const text = await file.text();
      if (!active.current || ticket !== generation.current) return;
      const value = parse(text);
      if (active.current && ticket === generation.current) loaded.current(value);
    } catch {
      if (active.current && ticket === generation.current) setError('无法读取报告或草稿：文件格式、结构或内部一致性检查未通过。当前报告与选择已保留。');
    } finally {
      if (active.current && ticket === generation.current) setBusy(false);
    }
  };
  return { read, busy, error, invalidate };
}
