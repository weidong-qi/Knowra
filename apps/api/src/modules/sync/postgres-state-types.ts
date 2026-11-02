import type * as Models from '@prisma/client';
import type { Prisma } from '@prisma/client';

type IsoRow<Row> = {
  [Field in keyof Row]: Row[Field] extends Date | null ? string | Extract<Row[Field], null> : Row[Field];
};
/** 原 mapper 只转换日期/标量和部分数组；JSON 列仍是未校验的数据库载荷。 */
export interface SyncMappedEntityMap {
  spaces: IsoRow<Models.KnowledgeSpace>;
  folders: IsoRow<Models.Folder>;
  tags: IsoRow<Models.Tag>;
  tagGroups: IsoRow<Models.TagGroup>;
  notes: Omit<IsoRow<Models.Note>, 'deletedAt' | 'internalLinks'> & {
    deleted: boolean;
    internalLinks: Prisma.JsonValue[];
    tagIds: string[];
  };
  noteVersions: IsoRow<Models.NoteVersion>;
  attachments: IsoRow<Models.Attachment>;
  contentAnnotations: Omit<IsoRow<Models.ContentAnnotation>, 'headingPath'> & { headingPath: Prisma.JsonValue[] };
  annotationExclusions: IsoRow<Models.AnnotationExclusion>;
  annotationRevisions: IsoRow<Models.AnnotationRevision>;
  analysisScopeSnapshots: IsoRow<Models.AnalysisScopeSnapshot>;
  knowledgeItems: IsoRow<Models.KnowledgeItem>;
  knowledgeEvidence: Omit<IsoRow<Models.KnowledgeEvidence>, 'headingPath'> & { headingPath: Prisma.JsonValue[] };
  knowledgeArtifactProvenance: import('../knowledge/domain/knowledge-artifact-provenance-contract.ts').KnowledgeArtifactProvenance;
  learningObjectives: IsoRow<Models.LearningObjective>;
  examProfiles: Omit<IsoRow<Models.ExamProfile>, 'scope' | 'commonQuestionTypes' | 'difficultyProfile'> & {
    scope: Prisma.JsonValue[];
    commonQuestionTypes: Prisma.JsonValue[];
    difficultyProfile: Prisma.JsonObject | Prisma.JsonArray;
  };
  examFocuses: Omit<IsoRow<Models.ExamFocus>, 'questionTypeSuggestions'> & {
    questionTypeSuggestions: Prisma.JsonValue[];
  };
  questions: IsoRow<Models.Question>;
  questionObjectives: IsoRow<Models.QuestionObjective>;
  questionSources: IsoRow<Models.QuestionSource>;
}
