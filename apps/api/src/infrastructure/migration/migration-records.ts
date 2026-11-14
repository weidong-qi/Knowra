import type * as Models from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { SyncMappedEntityMap } from '../../modules/sync/postgres-state-types.ts';
import type {
  AnalysisScopeAliasSnapshot,
  AnalysisScopeVersionBinding
} from '../../modules/knowledge/domain/analysis-scope-version-alias.ts';
import type { KnowledgeArtifactProvenance } from '../../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import type { MigrationReportTools } from './migration-report.ts';
import type * as transforms from './json-transformers.ts';

/** 旧 JSON 的日期和可转换数值尚未归一化；字段默认值继续由原 transformer 决定。 */
type LegacyRow<Row> = {
  [Key in keyof Row]?: Key extends `${string}At` | 'sortOrder' | 'importance' | 'order' | 'priority' | 'version'
    ? Prisma.JsonValue
    : Row[Key];
} & { id: string };
type LegacyCollection<Key extends keyof SyncMappedEntityMap> = LegacyRow<SyncMappedEntityMap[Key]>;
export interface MigrationSourceMap {
  spaces: LegacyCollection<'spaces'> & { userId: string; name: string };
  folders: LegacyCollection<'folders'> & { spaceId: string; name: string };
  tags: LegacyCollection<'tags'> & { spaceId: string; name: string };
  tagGroups: LegacyCollection<'tagGroups'> & { spaceId: string; name: string };
  notes: LegacyCollection<'notes'> & { title: string; rawMarkdown: string; deletedAt?: Prisma.JsonValue };
  noteVersions: LegacyCollection<'noteVersions'> & {
    noteId: string;
    content: string;
    contentHash: string;
    createdBy: string;
  };
  attachments: LegacyCollection<'attachments'> & { noteId: string; fileName: string };
  contentAnnotations: LegacyCollection<'contentAnnotations'> & { spaceId: string; noteId: string };
  annotationExclusions: LegacyCollection<'annotationExclusions'> & { parentAnnotationId: string };
  annotationRevisions: LegacyCollection<'annotationRevisions'> & { annotationId: string; revision: number };
  analysisScopeSnapshots: Omit<
    LegacyCollection<'analysisScopeSnapshots'>,
    'noteVersions' | 'segments' | 'contextSegments'
  > &
    AnalysisScopeAliasSnapshot & { spaceId: string; noteVersions?: AnalysisScopeVersionBinding[] };
  knowledgeItems: LegacyCollection<'knowledgeItems'>;
  knowledgeEvidence: LegacyCollection<'knowledgeEvidence'> & { knowledgeItemId: string };
  learningObjectives: LegacyCollection<'learningObjectives'> & { knowledgeItemId: string };
  examProfiles: LegacyCollection<'examProfiles'>;
  examFocuses: LegacyCollection<'examFocuses'> & { examProfileId: string; learningObjectiveId: string };
  questions: LegacyCollection<'questions'>;
  questionObjectives: LegacyCollection<'questionObjectives'> & { questionId: string; learningObjectiveId: string };
  questionSources: LegacyCollection<'questionSources'> & { questionId: string };
  pdfAnnotations: SyncMappedEntityMap['pdfAnnotations'];
  knowledgeArtifactProvenance: KnowledgeArtifactProvenance;
  knowledgeConcepts: SyncMappedEntityMap['knowledgeConcepts'];
  knowledgeConceptLinks: SyncMappedEntityMap['knowledgeConceptLinks'];
  knowledgeConceptRelations: SyncMappedEntityMap['knowledgeConceptRelations'];
  personalTodos: SyncMappedEntityMap['personalTodos'];
}
export type MigrationSourceState = { [Key in keyof MigrationSourceMap]: MigrationSourceMap[Key][] };
export type MigrationUser = Omit<Models.User, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };
export interface MigrationPlan {
  users: MigrationUser[];
  spaces: ReturnType<typeof transforms.transformSpace>[];
  folders: ReturnType<typeof transforms.transformFolder>[];
  tags: ReturnType<typeof transforms.transformTag>[];
  tagGroups: ReturnType<typeof transforms.transformTagGroup>[];
  notes: ReturnType<typeof transforms.transformNote>[];
  noteVersions: ReturnType<typeof transforms.transformNoteVersion>[];
  knowledgeItems: ReturnType<typeof transforms.transformKnowledgeItem>[];
  knowledgeEvidence: ReturnType<typeof transforms.transformKnowledgeEvidence>[];
  learningObjectives: ReturnType<typeof transforms.transformLearningObjective>[];
  examProfiles: ReturnType<typeof transforms.transformExamProfile>[];
  examFocuses: ReturnType<typeof transforms.transformExamFocus>[];
  questions: ReturnType<typeof transforms.transformQuestion>[];
  questionObjectives: ReturnType<typeof transforms.transformQuestionObjective>[];
  questionSources: ReturnType<typeof transforms.transformQuestionSource>[];
  annotations: ReturnType<typeof transforms.transformAnnotation>[];
  annotationExclusions: (MigrationSourceMap['annotationExclusions'] & {
    createdAt: string | Prisma.JsonValue;
    updatedAt: string | Prisma.JsonValue;
  })[];
  annotationRevisions: (MigrationSourceMap['annotationRevisions'] & { createdAt: string | Prisma.JsonValue })[];
  analysisScopeSnapshots: (MigrationSourceMap['analysisScopeSnapshots'] & { createdAt: string | Prisma.JsonValue })[];
  attachments: NonNullable<ReturnType<typeof transforms.transformAttachment>>[];
  noteTags: { noteId: string; tagId: string }[];
  pdfAnnotations: MigrationSourceMap['pdfAnnotations'][];
  knowledgeArtifactProvenance: KnowledgeArtifactProvenance[];
  knowledgeConcepts: MigrationSourceMap['knowledgeConcepts'][];
  knowledgeConceptLinks: MigrationSourceMap['knowledgeConceptLinks'][];
  knowledgeConceptRelations: MigrationSourceMap['knowledgeConceptRelations'][];
  personalTodos: MigrationSourceMap['personalTodos'][];
}
export interface MigrationAttachmentOptions {
  storageRootDir: string;
  uploadsDir?: string;
  noteIds: Set<string>;
  allowMissingAttachments: boolean;
  fallbackTimestamp: string;
  reportTools: MigrationReportTools;
}
