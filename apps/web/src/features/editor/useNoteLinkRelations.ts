import { useEffect, useState } from 'react';
import type { NoteLinkRelations } from '@study-accelerator/web-core';

export function useNoteLinkRelations(noteId: string | undefined, spaceId: string | undefined, refreshKey: unknown,
  getRelations?: (id: string) => Promise<NoteLinkRelations>) {
  const [snapshot, setSnapshot] = useState<{ id: string; space: string; value: NoteLinkRelations } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setError('');
    if (!noteId || !spaceId || !getRelations) { setLoading(false); return; }
    setLoading(true);
    void getRelations(noteId).then(value => {
      if (!active) return;
      if (value.noteId !== noteId || value.spaceId !== spaceId) throw new Error('引用查询已失效，请刷新');
      setSnapshot({ id: noteId, space: spaceId, value });
    }).catch(cause => { if (active) { setSnapshot(null); setError(cause instanceof Error ? cause.message : '引用查询失败'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [noteId, spaceId, refreshKey, getRelations]);
  return { relations: snapshot && snapshot.id === noteId && snapshot.space === spaceId ? snapshot.value : undefined, error, loading };
}
