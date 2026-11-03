import { apiClient } from '@study-accelerator/web-core';
import { readRuntimeConfig } from '../../app/runtimeConfig';
import { getNoteDraftScope } from './noteDraftScope';
const key = 'knowra:ai-draft-locks:v1';
const leaseMs = 120000;
interface Lock { clientId: string; serverClientId?: string; scope: string; noteId: string; expiresAt: number }
interface Pending { scope: string; serverClientId: string; noteId: string; dirty: boolean; version: number; confirmed: number; error: Error | null }
export function createAiDraftCoordination({ clientId, storage, send, now = Date.now, isCurrentScope = () => true, schedule = callback => { const timer = setInterval(callback, 30000); return () => clearInterval(timer); } }: {
  clientId: string; storage: Pick<Storage, 'getItem' | 'setItem'>;
  send(input: { clientId: string; noteId: string; dirty: boolean }): Promise<unknown>;
  now?: () => number; isCurrentScope?: (scope: string) => boolean; schedule?: (callback: () => void) => () => void;
}) {
  let tail = Promise.resolve();
  let stopHeartbeat: (() => void) | undefined;
  const pending = new Map<string, Pending>();
  const storageErrors = new Map<string, Error>();
  function locks(): Lock[] {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    if (!Array.isArray(value) || value.some(row => !row || typeof row.clientId !== 'string' || typeof row.scope !== 'string' || typeof row.noteId !== 'string' || (row.serverClientId !== undefined && typeof row.serverClientId !== 'string'))) throw new Error('草稿协调记录无效，请保留恢复草稿。');
    let changed = false;
    const current: Lock[] = [];
    for (const row of value) {
      if (row.expiresAt === undefined) { row.expiresAt = now() + leaseMs; changed = true; }
      if (typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt)) throw new Error('草稿协调期限无效，请保留恢复草稿。');
      if (row.expiresAt > now()) current.push(row as Lock); else changed = true;
    }
    // 旧无期限标记只迁移一次，并写回有限宽限期。
    if (changed) storage.setItem(key, JSON.stringify(current));
    return current;
  }
  function enqueue(row: Pending) {
    const version = row.version, dirty = row.dirty;
    tail = tail.then(async () => {
      // 同一草稿的新状态覆盖尚未发送的旧状态，已发送的状态仍按序完成。
      if (row.version !== version || row.confirmed === version) return;
      if (!isCurrentScope(row.scope)) return;
      try {
        await send({ clientId: row.serverClientId, noteId: row.noteId, dirty });
        if (row.version === version) { row.confirmed = version; row.error = null; }
      } catch { if (row.version === version) row.error = new Error('草稿状态尚未确认，请先保存草稿并重试。'); }
    });
  }
  function persist(row: Pending, localKey: string) {
    try {
      const current = locks().filter(lock => !(lock.clientId === clientId && lock.scope === row.scope && lock.noteId === row.noteId));
      if (row.dirty) current.push({ clientId, serverClientId: row.serverClientId, scope: row.scope, noteId: row.noteId, expiresAt: now() + leaseMs });
      storage.setItem(key, JSON.stringify(current)); storageErrors.delete(localKey);
    } catch { storageErrors.set(localKey, new Error('草稿协调存储不可用，请先保存草稿再执行 AI 写入。')); }
  }
  function renewDirty() {
    for (const [localKey, row] of pending) if (row.dirty && isCurrentScope(row.scope)) {
      row.version++; persist(row, localKey); enqueue(row);
    }
  }
  function manageHeartbeat() {
    if ([...pending.values()].some(row => row.dirty && isCurrentScope(row.scope))) {
      stopHeartbeat ??= schedule(renewDirty);
    } else { stopHeartbeat?.(); stopHeartbeat = undefined; }
  }
  function scopedClientId(scope: string) {
    const existing = [...pending.values()].find(row => row.scope === scope);
    if (existing) return existing.serverClientId;
    try {
      const lock = locks().find(row => row.clientId === clientId && row.scope === scope);
      if (lock?.serverClientId) return lock.serverClientId;
    } catch { /* persist 将记录存储错误，flush 阻止确认。 */ }
    // 数据集切换后的旧 scope 重试不能清除新 scope 的服务端草稿标记。
    return crypto.randomUUID();
  }
  return {
    close() { stopHeartbeat?.(); stopHeartbeat = undefined; },
    register(scope: string, noteId: string, dirty: boolean) {
      const localKey = JSON.stringify([scope, noteId]);
      let row = pending.get(localKey);
      if (!row) { row = { scope, serverClientId: scopedClientId(scope), noteId, dirty, version: 1, confirmed: 0, error: null }; pending.set(localKey, row); }
      else if (row.dirty !== dirty) { row.dirty = dirty; row.version++; row.error = null; }
      if (isCurrentScope(scope)) { persist(row, localKey); if (row.confirmed !== row.version) enqueue(row); }
      manageHeartbeat();
    },
    hasDraft(scope: string, noteIds: string[]) { return locks().some(row => row.scope === scope && noteIds.includes(row.noteId)); },
    async flush() {
      await tail;
      renewDirty(); manageHeartbeat();
      // 每个草稿独立保留失败；其他笔记的成功不能掩盖失败。允许清除锁失败后重试。
      for (const [localKey, row] of pending) {
        if (!isCurrentScope(row.scope)) continue;
        if (storageErrors.has(localKey)) persist(row, localKey);
        if (row.confirmed !== row.version) enqueue(row);
      }
      for (let attempt = 0; attempt < 3; attempt++) { const latest = tail; await latest; if (latest === tail) break; }
      const current = [...pending.entries()].filter(([, row]) => isCurrentScope(row.scope));
      const error = current.map(([localKey]) => storageErrors.get(localKey)).find(Boolean) ?? current.find(([, row]) => row.error)?.[1].error;
      if (error) throw error;
      if (current.some(([, row]) => row.confirmed !== row.version)) throw new Error('草稿状态仍在确认，请重试。');
    }
  };
}
let singleton: ReturnType<typeof createAiDraftCoordination> | undefined;
function coordination() {
  if (!singleton) {
    let clientId: string;
    try { clientId = sessionStorage.getItem(`${key}:client`) ?? crypto.randomUUID(); sessionStorage.setItem(`${key}:client`, clientId); }
    catch { clientId = crypto.randomUUID(); }
    singleton = createAiDraftCoordination({ clientId, isCurrentScope: scope => {
      const runtime = readRuntimeConfig();
      if (runtime.persistenceMode !== 'desktop-local' || runtime.legacyDraftsAllowed) return !scope.startsWith('[');
      try { const parts: unknown = JSON.parse(scope); return Array.isArray(parts) && parts.length === 2 && typeof parts[1] === 'string' && getNoteDraftScope(parts[1], runtime) === scope; } catch { return false; }
    }, storage: { getItem: name => localStorage.getItem(name), setItem: (name, value) => localStorage.setItem(name, value) }, send: input => apiClient.requestJson('/api/ai/actions/drafts', {
      method: 'POST', headers: { 'X-Knowra-AI-Action': '1' }, body: JSON.stringify(input)
    }) });
  }
  return singleton;
}
window.addEventListener('pagehide', () => singleton?.close());
window.addEventListener('pageshow', () => { void singleton?.flush().catch(() => {}); });
window.addEventListener('focus', () => { void singleton?.flush().catch(() => {}); });
export const closeAiDraftCoordination = () => singleton?.close();
export const registerAiDraft = (scope: string, noteId: string, dirty: boolean) => coordination().register(scope, noteId, dirty);
export const hasCoordinatedDraft = (scope: string, noteIds: string[]) => coordination().hasDraft(scope, noteIds);
export const flushAiDraftCoordination = () => coordination().flush();
