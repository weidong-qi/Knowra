import { assertProvenanceWrite } from '../knowledge-artifact-provenance-repository.js';
import { mapKnowledgeArtifactProvenance } from './mappers.ts';
import { dbKnowledgeArtifactProvenance } from '../../../../infrastructure/migration/db-mappers.js';
import { withRepositoryErrors } from './repository-utils.js';
import { createAppError } from '../../../../errors/app-error.js';

export function createPostgresKnowledgeArtifactProvenanceRepository({ db }) {
  if (!db?.knowledgeArtifactProvenance)
    throw new TypeError('PostgreSQL provenance repository requires db.knowledgeArtifactProvenance');
  const write = (record, upgradeLegacy = false) =>
    withRepositoryErrors(async () => {
      const data = dbKnowledgeArtifactProvenance(record);
      const existing = mapKnowledgeArtifactProvenance(
        await db.knowledgeArtifactProvenance.findUnique({ where: { artifactId: record.artifactId } })
      );
      assertProvenanceWrite(existing, record, { upgradeLegacy });
      if (existing?.provenanceHash === record.provenanceHash) return existing;
      if (!existing) return mapKnowledgeArtifactProvenance(await db.knowledgeArtifactProvenance.create({ data }));
      // Compare-and-swap prevents a second writer from replacing a concurrent recorded upgrade.
      const result = await db.knowledgeArtifactProvenance.updateMany({
        where: { id: existing.id, state: 'legacy-unavailable', provenanceHash: existing.provenanceHash },
        data
      });
      if (result.count !== 1) {
        const current = mapKnowledgeArtifactProvenance(
          await db.knowledgeArtifactProvenance.findUnique({ where: { id: record.id } })
        );
        if (!current) throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT', '来源记录已被并发删除。', 409);
        assertProvenanceWrite(current, record);
      }
      return structuredClone(record);
    });
  return {
    supportsAsync: true,
    create: record => write(record),
    upgradeLegacy: record => write(record, true),
    findById: id =>
      withRepositoryErrors(() =>
        db.knowledgeArtifactProvenance.findUnique({ where: { id } }).then(mapKnowledgeArtifactProvenance)
      ),
    findByArtifactId: artifactId =>
      withRepositoryErrors(() =>
        db.knowledgeArtifactProvenance.findUnique({ where: { artifactId } }).then(mapKnowledgeArtifactProvenance)
      ),
    /** @param {{ artifactId?: string }} options */
    list: ({ artifactId } = {}) =>
      withRepositoryErrors(() =>
        db.knowledgeArtifactProvenance
          .findMany({
            where: artifactId ? { artifactId } : {},
            orderBy: { id: 'asc' }
          })
          .then(rows => rows.map(mapKnowledgeArtifactProvenance))
      ),
    deleteByKnowledgeItemId: artifactId =>
      withRepositoryErrors(async () => {
        const rows = await db.knowledgeArtifactProvenance.findMany({ where: { artifactId } });
        if (rows.length) await db.knowledgeArtifactProvenance.deleteMany({ where: { artifactId } });
        return rows.map(mapKnowledgeArtifactProvenance);
      })
  };
}
