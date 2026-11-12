import { assertProvenanceWrite } from '../knowledge-artifact-provenance-repository.ts';
import { mapKnowledgeArtifactProvenance } from './mappers.ts';
import { dbKnowledgeArtifactProvenance } from '../../../../infrastructure/migration/db-mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';
import { createAppError } from '../../../../errors/app-error.ts';
import type { KnowledgeArtifactProvenance } from '../../domain/knowledge-artifact-provenance-contract.ts';
import type { ProvenanceRepositoryOptions } from './knowledge-graph-repository-types.ts';

type RawProvenanceIdentity = Partial<Record<'id' | 'artifactId' | 'provenanceHash', unknown>>;

export function createPostgresKnowledgeArtifactProvenanceRepository({ db }: ProvenanceRepositoryOptions) {
  if (!db?.knowledgeArtifactProvenance)
    throw new TypeError('PostgreSQL provenance repository requires db.knowledgeArtifactProvenance');
  const write = (record: unknown, upgradeLegacy = false) =>
    withRepositoryErrors(async () => {
      const data = dbKnowledgeArtifactProvenance(record);
      const existing = mapKnowledgeArtifactProvenance(
        await db.knowledgeArtifactProvenance.findUnique({
          where: { artifactId: (record as RawProvenanceIdentity).artifactId }
        })
      );
      assertProvenanceWrite(existing, record, { upgradeLegacy });
      if (existing?.provenanceHash === (record as RawProvenanceIdentity).provenanceHash) return existing;
      if (!existing) return mapKnowledgeArtifactProvenance(await db.knowledgeArtifactProvenance.create({ data }));
      // Compare-and-swap prevents a second writer from replacing a concurrent recorded upgrade.
      const result = await db.knowledgeArtifactProvenance.updateMany({
        where: { id: existing.id, state: 'legacy-unavailable', provenanceHash: existing.provenanceHash },
        data
      });
      if (result.count !== 1) {
        const current = mapKnowledgeArtifactProvenance(
          await db.knowledgeArtifactProvenance.findUnique({ where: { id: (record as RawProvenanceIdentity).id } })
        );
        if (!current) throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT', '来源记录已被并发删除。', 409);
        assertProvenanceWrite(current, record);
      }
      return structuredClone(record);
    });
  return {
    supportsAsync: true,
    create: (record: unknown) => write(record),
    upgradeLegacy: (record: unknown) => write(record, true),
    findById: (id: unknown) =>
      withRepositoryErrors(() =>
        db.knowledgeArtifactProvenance
          .findUnique({ where: { id } })
          .then<KnowledgeArtifactProvenance | null>(mapKnowledgeArtifactProvenance)
      ),
    findByArtifactId: (artifactId: unknown) =>
      withRepositoryErrors(() =>
        db.knowledgeArtifactProvenance
          .findUnique({ where: { artifactId } })
          .then<KnowledgeArtifactProvenance | null>(mapKnowledgeArtifactProvenance)
      ),
    list: ({ artifactId }: { artifactId?: string } = {}) =>
      withRepositoryErrors(() =>
        db.knowledgeArtifactProvenance
          .findMany({
            where: artifactId ? { artifactId } : {},
            orderBy: { id: 'asc' }
          })
          .then(rows => rows.map(mapKnowledgeArtifactProvenance))
      ),
    deleteByKnowledgeItemId: (artifactId: unknown) =>
      withRepositoryErrors(async () => {
        const rows = await db.knowledgeArtifactProvenance.findMany({ where: { artifactId } });
        if (rows.length) await db.knowledgeArtifactProvenance.deleteMany({ where: { artifactId } });
        return rows.map(mapKnowledgeArtifactProvenance);
      })
  };
}
