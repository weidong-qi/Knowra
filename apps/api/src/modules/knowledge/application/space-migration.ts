import { createHash } from 'node:crypto';
import { createAppError } from '../../../errors/app-error.ts';
import { buildDefaultTagGroups } from '../domain/default-tag-groups.ts';

import type { Prisma } from '@prisma/client';

interface MigrationAsset {
  id: string;
  isSystem?: boolean;
}
interface MigrationNote extends MigrationAsset {
  spaceId?: string | null;
  internalLinks?: Prisma.JsonValue[] | null;
}
export interface SpaceMigrationAssets {
  folders: MigrationAsset[];
  notes: MigrationNote[];
  tags: (MigrationAsset & { groupId?: string | null })[];
  tagGroups: (MigrationAsset & { name: string; code?: string | null })[];
  annotations: MigrationAsset[];
  pdfAnnotations: MigrationAsset[];
  analysisScopes: MigrationAsset[];
}
export interface SpaceMigrationInput {
  source: { id: string; userId: string; updatedAt?: string | null } | null;
  target: { id: string; userId: string; updatedAt?: string | null } | null;
  sourceAssets: SpaceMigrationAssets;
  targetAssets: SpaceMigrationAssets;
  allNotes: MigrationNote[];
  allNoteVersions?: { id: string; noteId: string }[];
}

const kinds = ['folders', 'notes', 'tags', 'tagGroups', 'annotations', 'pdfAnnotations', 'analysisScopes'] as const;

function collectNoteIds(value: unknown, found = new Set<string>(), seen = new Set<object>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  if (typeof (value as { noteId?: unknown }).noteId === 'string') found.add((value as { noteId: string }).noteId);
  for (const child of Object.values(value as Record<string, unknown>)) collectNoteIds(child, found, seen);
  return found;
}

function collectNoteVersionIds(value: unknown, found = new Set<string>(), seen = new Set<object>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  if (typeof (value as { noteVersionId?: unknown }).noteVersionId === 'string')
    found.add((value as { noteVersionId: string }).noteVersionId);
  for (const child of Object.values(value as Record<string, unknown>)) collectNoteVersionIds(child, found, seen);
  return found;
}

export function inspectSpaceMigration({
  source,
  target,
  sourceAssets,
  targetAssets,
  allNotes,
  allNoteVersions = []
}: SpaceMigrationInput) {
  if (!source || !target) throw createAppError('KNOWLEDGE_SPACE_NOT_FOUND', '源空间或目标空间不存在。', 404);
  const blockers: string[] = [];
  if (source.id === target.id) blockers.push('SAME_SPACE');
  if (source.userId !== target.userId) blockers.push('OWNER_MISMATCH');
  if (kinds.some(kind => targetAssets[kind].some(item => kind !== 'tagGroups' || !item.isSystem)))
    blockers.push('TARGET_NOT_EMPTY');
  const sourceNoteIds = new Set<Prisma.JsonValue | undefined>(sourceAssets.notes.map(note => note.id));
  const versionNoteIds = new Map(allNoteVersions.map(version => [version.id, version.noteId]));
  for (const note of sourceAssets.notes) {
    if ((note.internalLinks ?? []).some(id => !sourceNoteIds.has(id))) blockers.push('CROSS_SPACE_NOTE_LINK');
  }
  for (const note of allNotes.filter(note => note.spaceId !== source.id)) {
    if ((note.internalLinks ?? []).some(id => sourceNoteIds.has(id))) blockers.push('CROSS_SPACE_NOTE_LINK');
  }
  for (const scope of sourceAssets.analysisScopes) {
    if ([...collectNoteIds(scope)].some(id => !sourceNoteIds.has(id))) blockers.push('CROSS_SPACE_SCOPE_REFERENCE');
    if ([...collectNoteVersionIds(scope)].some(id => !sourceNoteIds.has(versionNoteIds.get(id))))
      blockers.push('CROSS_SPACE_SCOPE_REFERENCE');
  }
  const defaults = buildDefaultTagGroups(target.id);
  const targetGroupNames = new Set(
    [...targetAssets.tagGroups.filter(group => group.isSystem), ...defaults].map(group => group.name)
  );
  if (sourceAssets.tagGroups.some(group => !group.isSystem && targetGroupNames.has(group.name)))
    blockers.push('GROUP_NAME_CONFLICT');
  const availableSystemCodes = new Set(
    [...targetAssets.tagGroups.filter(group => group.isSystem), ...defaults].map(group => group.code)
  );
  if (sourceAssets.tagGroups.some(group => group.isSystem && !availableSystemCodes.has(group.code)))
    blockers.push('SYSTEM_GROUP_UNMAPPED');
  const sourceGroupIds = new Set(sourceAssets.tagGroups.map(group => group.id));
  if (sourceAssets.tags.some(tag => tag.groupId && !sourceGroupIds.has(tag.groupId)))
    blockers.push('TAG_GROUP_OUTSIDE_SPACE');
  const payload = kinds.map(kind => [
    kind,
    sourceAssets[kind].map(item => [item.id, item] as const).sort(([a], [b]) => a.localeCompare(b)),
    targetAssets[kind].map(item => [item.id, item] as const).sort(([a], [b]) => a.localeCompare(b))
  ]);
  const previewHash = createHash('sha256')
    .update(JSON.stringify([source.id, target.id, source.updatedAt, target.updatedAt, payload]))
    .digest('hex');
  return {
    sourceSpaceId: source.id,
    targetSpaceId: target.id,
    previewHash,
    decision: blockers.length ? 'blocked' : 'can-migrate',
    blockers: [...new Set(blockers)],
    counts: Object.fromEntries(kinds.map(kind => [kind, sourceAssets[kind].length])),
    coverage: {
      spaceScopedAssets: kinds,
      globalKnowledgeAndTraining: 'unchanged',
      offlineDevices: 'pending-sync',
      backups: 'retention-managed'
    }
  };
}

export function assertSpaceMigrationAllowed(
  preview: ReturnType<typeof inspectSpaceMigration>,
  expectedPreviewHash: string | null | undefined
) {
  if (!expectedPreviewHash || preview.previewHash !== expectedPreviewHash)
    throw createAppError('SPACE_MIGRATION_PREVIEW_STALE', '空间内容已变化，请重新预检。', 409, { preview });
  if (preview.decision !== 'can-migrate')
    throw createAppError('SPACE_MIGRATION_BLOCKED', '迁移范围存在无法安全处理的引用或目标内容。', 409, { preview });
}
