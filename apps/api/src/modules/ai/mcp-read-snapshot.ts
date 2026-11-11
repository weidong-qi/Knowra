import { calculateContentHash } from '@study-accelerator/content-anchor';
import { hashRecord } from './record-contract.ts';

import type { SnapshotDependencies, OutputGuard } from './mcp-read-snapshot-types.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { NoteRecord } from '../knowledge/infrastructure/note-repository.ts';

const copy = <T>(value: T): T => structuredClone(value);

/** 最终同步外发检查：快照只存在于 WeakMap，禁止将其序列化给客户端。 */
export function createMcpReadSnapshotGuard({ repos, ownerId, accessStore, unavailable }: SnapshotDependencies) {
  const outputGuards = new WeakMap<object, OutputGuard>();
  const sync = <T>(value: T | Promise<T>): T => {
    const candidate = value as Promise<T> | null | undefined;
    if (candidate?.then) {
      candidate.catch?.(() => {});
      throw unavailable();
    }
    return value as T;
  };
  const remember = <T extends object>(output: T, guard: OutputGuard) => {
    outputGuards.set(output, { ...guard, outputHash: hashRecord(output) });
    return output;
  };

  function assertGrantNow(grantId: string, identity: DatasetIdentity, notes: Map<string, NoteRecord>) {
    if (
      typeof accessStore.peekIdentity !== 'function' ||
      typeof accessStore.peek !== 'function' ||
      hashRecord(sync(accessStore.peekIdentity())) !== hashRecord(identity)
    )
      throw unavailable();
    const grant = sync(accessStore.peek('aiRunGrant', grantId));
    const policy = grant && sync(accessStore.peek('aiAccessPolicy', grant.policyId));
    const now = Date.now();
    if (
      !grant ||
      !policy ||
      grant.ownerId !== ownerId ||
      grant.actorId !== ownerId ||
      policy.ownerId !== ownerId ||
      policy.actorId !== ownerId ||
      policy.revokedAt ||
      policy.read !== true ||
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= now ||
      !Number.isFinite(Date.parse(policy.expiresAt)) ||
      Date.parse(policy.expiresAt) <= now ||
      !grant.allowedTools?.includes('notes_read') ||
      !grant.allowedTools?.includes('notes_search') ||
      !['library', 'fixed', 'folder'].includes(policy.scope?.kind) ||
      !Array.isArray(policy.excludedNoteIds) ||
      policy.revision !== grant.policyRevision ||
      grant.spaceId !== policy.spaceId ||
      [grant, policy].some(
        value => value.datasetId !== identity.datasetId || value.datasetEpoch !== identity.datasetEpoch
      ) ||
      sync(repos.knowledgeSpaceRepository.findById(policy.spaceId))?.userId !== ownerId
    )
      throw unavailable();
    for (const note of notes.values()) {
      if (
        note.spaceId !== policy.spaceId ||
        policy.excludedNoteIds?.includes(note.id) ||
        (policy.scope?.kind === 'fixed' && !policy.scope.noteIds?.includes(note.id))
      )
        throw unavailable();
      if (policy.scope?.kind === 'folder') {
        let folderId = note.folderId,
          allowed = false;
        const seen = new Set();
        while (folderId && !seen.has(folderId)) {
          seen.add(folderId);
          const folder = sync(repos.folderRepository?.findById(folderId));
          if (!folder || folder.deletedAt || folder.spaceId !== policy.spaceId) break;
          if (folderId === policy.scope.folderId) {
            allowed = true;
            break;
          }
          folderId = folder.parentId;
        }
        if (!allowed) throw unavailable();
      } else if (!['library', 'fixed'].includes(policy.scope?.kind)) throw unavailable();
    }
  }

  function assertOutputCurrent(output: object) {
    const guard = outputGuards.get(output);
    if (!guard || hashRecord(output) !== guard.outputHash) throw unavailable();
    const notes = new Map<string, NoteRecord>();
    for (const value of guard.checkedItems) {
      const candidateId = (value.state.item?.id ?? value.knowledgeId) as string;
      const evidence = sync(repos.knowledgeEvidenceRepository.list({ knowledgeItemId: candidateId }));
      if (!Array.isArray(evidence)) throw unavailable();
      const current = {
        item: sync(repos.knowledgeItemRepository.findById(candidateId)),
        evidence: [...evidence].sort((a, b) => a.id.localeCompare(b.id)),
        provenance: sync(repos.knowledgeArtifactProvenanceRepository.findByArtifactId(candidateId))
      };
      if (hashRecord(current) !== hashRecord(value.state)) throw unavailable();
      for (const [noteId, before] of value.reads) {
        const note = sync(repos.noteRepository?.findById(noteId));
        if (!note || hashRecord(note) !== hashRecord(before.note)) throw unavailable();
        const version = sync(repos.noteVersionRepository.findById(before.version.id as string));
        if (hashRecord(version) !== hashRecord(before.version)) throw unavailable();
        notes.set(noteId, note);
      }
      for (const [versionId, before] of value.versions ?? []) {
        if (hashRecord(sync(repos.noteVersionRepository.findById(versionId))) !== hashRecord(before))
          throw unavailable();
      }
      for (const [annotationId, before] of value.annotations ?? []) {
        if (hashRecord(sync(repos.contentAnnotationRepository?.findById(annotationId))) !== hashRecord(before))
          throw unavailable();
      }
    }
    assertGrantNow(guard.grantId, guard.identity, notes);
  }

  function captureNavigationGuard({ grantId }: { grantId: string }) {
    const snapshotNow = () => {
      const identity = sync(accessStore.peekIdentity());
      const grant = sync(accessStore.peek('aiRunGrant', grantId));
      const policy = grant && sync(accessStore.peek('aiAccessPolicy', grant.policyId));
      if (!grant || !policy) throw unavailable();
      const notes = sync(repos.noteRepository.list({ spaceId: policy.spaceId, includeDeleted: true }));
      const folders = sync(repos.folderRepository.list({ spaceId: policy.spaceId, includeDeleted: true }));
      if (!Array.isArray(notes) || !Array.isArray(folders)) throw unavailable();
      const byId = new Map(
        folders
          .filter(folder => folder.spaceId === policy.spaceId && !folder.deletedAt)
          .map(folder => [folder.id, folder])
      );
      const closure = new Map(),
        visible = [];
      for (const note of notes) {
        if (
          note.deleted ||
          (note as NoteRecord & { deletedAt?: string | null }).deletedAt ||
          (note.aiVisibility !== undefined && note.aiVisibility !== 'normal') ||
          note.spaceId !== policy.spaceId ||
          policy.excludedNoteIds?.includes(note.id) ||
          (policy.scope?.kind === 'fixed' && !policy.scope.noteIds?.includes(note.id))
        )
          continue;
        if (policy.scope?.kind === 'folder') {
          let cursor = note.folderId,
            allowed = false;
          const path = [],
            seen = new Set();
          while (cursor && !seen.has(cursor)) {
            seen.add(cursor);
            const folder = byId.get(cursor);
            if (!folder) break;
            path.push({ id: folder.id, spaceId: folder.spaceId, parentId: folder.parentId ?? null });
            if (cursor === policy.scope.folderId) {
              allowed = true;
              break;
            }
            cursor = folder.parentId;
          }
          if (!allowed) continue;
          for (const folder of path) closure.set(folder.id, folder);
        }
        const contentHash = calculateContentHash(note.rawMarkdown);
        const version = sync(repos.noteVersionRepository.findByNoteIdAndContentHash(note.id, contentHash));
        if (
          !version ||
          version.noteId !== note.id ||
          version.contentHash !== contentHash ||
          version.content !== note.rawMarkdown
        )
          throw unavailable();
        visible.push({
          noteId: note.id,
          title: note.title,
          folderId: note.folderId ?? null,
          noteVersionId: version.id,
          contentHash
        });
      }
      // 未授权条目的标题、正文与数量均不进入指纹，隐藏资料变化不能成为目录侧信道。
      return {
        identity,
        grant,
        policy,
        space: sync(repos.knowledgeSpaceRepository.findById(policy.spaceId)),
        notes: visible.sort((a, b) => a.noteId.localeCompare(b.noteId)),
        folders: [...closure.values()].sort((a, b) => a.id.localeCompare(b.id))
      };
    };
    const before = copy(snapshotNow()),
      fingerprint = hashRecord(before);
    assertGrantNow(grantId, before.identity, new Map());
    return () => {
      try {
        if (hashRecord(snapshotNow()) !== fingerprint) throw unavailable();
        assertGrantNow(grantId, before.identity, new Map());
      } catch {
        throw unavailable();
      }
    };
  }

  return {
    remember,
    assertCurrent: assertOutputCurrent,
    captureNavigationGuard,
    inherit<T extends object>(output: T, previous: object) {
      const guard = outputGuards.get(previous);
      if (!guard) throw unavailable();
      return remember(output, guard);
    }
  };
}
