import { createAppError } from '../../../errors/app-error.js';
import {
  validateKnowledgeArtifactProvenance,
  resolveKnowledgeArtifactProvenanceSource
} from '../domain/knowledge-artifact-provenance-contract.ts';

import type {
  KnowledgeArtifactProvenance,
  ProvenanceEvidence,
  ProvenanceKnowledgeItem,
  ProvenanceNote,
  ProvenanceNoteVersion,
  ResolvedProvenanceSource
} from '../domain/knowledge-artifact-provenance-contract.ts';

export type Awaitable<T> = T | Promise<T>;
export interface ProvenanceReaderItem extends ProvenanceKnowledgeItem {
  sourceMode?: unknown;
}
export interface ProvenanceReaderNote extends ProvenanceNote {
  spaceId?: string | null;
}
export interface ProvenanceReaderRepositories {
  knowledgeItemRepository: {
    findById(id: string): Awaitable<ProvenanceReaderItem | null | undefined>;
  };
  knowledgeArtifactProvenanceRepository: {
    findByArtifactId(artifactId: string): Awaitable<unknown>;
  };
  knowledgeEvidenceRepository: {
    findById(id: string): Awaitable<ProvenanceEvidence | null | undefined>;
  };
  noteRepository: {
    findById(id: string): Awaitable<ProvenanceReaderNote | null | undefined>;
  };
  knowledgeSpaceRepository: {
    findById(id: string | null | undefined): Awaitable<{ userId?: unknown } | null | undefined>;
  };
  noteVersionRepository: {
    findById(id: string): Awaitable<ProvenanceNoteVersion | null | undefined>;
  };
}
export interface ProvenanceReaderSource extends ResolvedProvenanceSource {
  evidenceId: string;
}
export type KnowledgeArtifactProvenanceProjection =
  | { artifactId: string; state: 'absent'; record: null; sources: [] }
  | {
      artifactId: string;
      state: KnowledgeArtifactProvenance['state'];
      record: KnowledgeArtifactProvenance;
      sources: ProvenanceReaderSource[];
    };
export type KnowledgeArtifactProvenanceReader = (
  artifactId: string,
  ownerId?: string | null
) => Promise<KnowledgeArtifactProvenanceProjection>;

/** 核心只读投影：当前来源的宿主授权与历史生成事实分别核对，不加载 AI。 */
export function createKnowledgeArtifactProvenanceReader(
  repositories: ProvenanceReaderRepositories
): KnowledgeArtifactProvenanceReader {
  return async (artifactId, ownerId) => {
    const item = await repositories.knowledgeItemRepository.findById(artifactId);
    const notFound = () => createAppError('KNOWLEDGE_ITEM_NOT_FOUND', '知识点不存在。', 404);
    if (!item) throw notFound();
    const input = await repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(artifactId);
    if (!input) {
      if (item.sourceMode === 'ai')
        throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_REQUIRED', 'AI 知识缺少明确的来源记录。', 422);
      return { artifactId, state: 'absent', record: null, sources: [] };
    }
    const record = validateKnowledgeArtifactProvenance(input);
    if (record.artifactId !== artifactId) throw notFound();
    const sources: ProvenanceReaderSource[] = [];
    for (const source of record.sources ?? []) {
      const [evidence, note] = await Promise.all([
        repositories.knowledgeEvidenceRepository.findById(source.evidenceId),
        repositories.noteRepository.findById(source.noteId)
      ]);
      const space = note ? await repositories.knowledgeSpaceRepository.findById(note.spaceId) : null;
      if (!ownerId || !space || space.userId !== ownerId) throw notFound();
      const noteVersion = evidence?.noteVersionId
        ? await repositories.noteVersionRepository.findById(evidence.noteVersionId)
        : null;
      if (evidence?.noteVersionId !== source.originNoteVersionId) {
        const original = await repositories.noteVersionRepository.findById(source.originNoteVersionId);
        if (original && (original.noteId !== source.noteId || original.contentHash !== source.contentHash)) {
          throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_SOURCE_MISMATCH', '原始来源版本身份不一致。', 422);
        }
      }
      sources.push({
        evidenceId: source.evidenceId,
        ...resolveKnowledgeArtifactProvenanceSource({
          record,
          source,
          evidence,
          noteVersion,
          note,
          knowledgeItem: item
        })
      });
    }
    return { artifactId, state: record.state, record, sources };
  };
}
