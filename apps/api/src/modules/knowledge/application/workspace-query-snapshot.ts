import { groupBy } from './workspace-query-utils.ts';

import type { WorkspaceReduce } from './workspace-query-utils.ts';

/** 仅约束原查询操作读取的字段，历史 ID/外键不保证经过领域验证。 */
export interface WorkspaceSnapshotIdRecord {
  id?: unknown;
}
export interface WorkspaceSnapshotItemRecord {
  knowledgeItemId?: unknown;
}
export interface WorkspaceSnapshotFocusRecord {
  examProfileId?: unknown;
}
export interface WorkspaceSnapshotLinkRecord {
  questionId?: unknown;
  learningObjectiveId?: unknown;
}
export interface WorkspaceSnapshotSourceRecord {
  questionId?: unknown;
}

/** 自定义 map 可忽略回调或返回独立 iterator，不能把结果当作数组。 */
export interface WorkspaceSnapshotMap<Record, Result = unknown> {
  map: (project: (record: Record) => unknown) => Result;
}
export type WorkspaceSnapshotGroups<Record> = WorkspaceReduce<Record, Map<unknown, Record[]>, unknown>;
export type WorkspaceSnapshotLinks = WorkspaceSnapshotGroups<WorkspaceSnapshotLinkRecord> &
  WorkspaceReduce<WorkspaceSnapshotLinkRecord, Map<unknown, unknown[]>, unknown>;

/** 只保留传入集合的静态契约，不证明是数组；普通值、Promise 与 thenable 均走原 Promise.all。 */
export interface WorkspaceSnapshotRepositories<
  QuestionIds = unknown,
  Notes = WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord>,
  NoteVersions = WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord>,
  KnowledgeItems = unknown,
  Evidence = WorkspaceSnapshotGroups<WorkspaceSnapshotItemRecord>,
  Objectives = WorkspaceSnapshotGroups<WorkspaceSnapshotItemRecord>,
  Profiles = unknown,
  Focuses = WorkspaceSnapshotGroups<WorkspaceSnapshotFocusRecord>,
  Questions = WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord, QuestionIds>,
  QuestionObjectives = WorkspaceSnapshotLinks,
  QuestionSources = WorkspaceSnapshotGroups<WorkspaceSnapshotSourceRecord>
> {
  noteRepository: { list: (options: { includeDeleted: true }) => Notes | PromiseLike<Notes> };
  noteVersionRepository: { list: () => NoteVersions | PromiseLike<NoteVersions> };
  knowledgeItemRepository: {
    list: (options: { includeArchived: true; includeDeleted: true }) => KnowledgeItems | PromiseLike<KnowledgeItems>;
  };
  knowledgeEvidenceRepository: { list: () => Evidence | PromiseLike<Evidence> };
  learningObjectiveRepository: { list: (options: { includeArchived: true }) => Objectives | PromiseLike<Objectives> };
  examProfileRepository: { list: (options: { includeArchived: true }) => Profiles | PromiseLike<Profiles> };
  examFocusRepository: { list: (options: { includeArchived: true }) => Focuses | PromiseLike<Focuses> };
  questionRepository: {
    list: (options: {
      includeArchived: true;
    }) =>
      | (Questions & WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord, QuestionIds>)
      | PromiseLike<Questions & WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord, QuestionIds>>;
  };
  // 参数与上游 map 返回类型关联：本地支持 Iterable，PostgreSQL 使用数组。
  questionObjectiveRepository: {
    listByQuestionIds: (questionIds: QuestionIds) => QuestionObjectives | PromiseLike<QuestionObjectives>;
  };
  questionSourceRepository: { list: () => QuestionSources | PromiseLike<QuestionSources> };
}

// 仅扩大原 Map 构造器的输入，不验证 iterator 或隐藏公开未知结果。
type NativeSnapshotMap = new (entries: unknown) => Map<unknown, unknown>;

interface WorkspaceSnapshotIndexInput {
  notes: WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord>;
  noteVersions: WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord>;
  knowledgeItems: unknown;
  evidence: WorkspaceSnapshotGroups<WorkspaceSnapshotItemRecord>;
  objectives: WorkspaceSnapshotGroups<WorkspaceSnapshotItemRecord>;
  profiles: unknown;
  focuses: WorkspaceSnapshotGroups<WorkspaceSnapshotFocusRecord>;
  questions: WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord>;
  questionObjectives: WorkspaceSnapshotLinks;
  questionSources: WorkspaceSnapshotGroups<WorkspaceSnapshotSourceRecord>;
}

export function createWorkspaceSnapshotReader<
  QuestionIds = unknown,
  Notes extends WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord> = WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord>,
  NoteVersions extends WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord> =
    WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord>,
  KnowledgeItems = unknown,
  Evidence extends WorkspaceSnapshotGroups<WorkspaceSnapshotItemRecord> =
    WorkspaceSnapshotGroups<WorkspaceSnapshotItemRecord>,
  Objectives extends WorkspaceSnapshotGroups<WorkspaceSnapshotItemRecord> =
    WorkspaceSnapshotGroups<WorkspaceSnapshotItemRecord>,
  Profiles = unknown,
  Focuses extends WorkspaceSnapshotGroups<WorkspaceSnapshotFocusRecord> =
    WorkspaceSnapshotGroups<WorkspaceSnapshotFocusRecord>,
  Questions extends WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord, QuestionIds> = WorkspaceSnapshotMap<
    WorkspaceSnapshotIdRecord,
    QuestionIds
  >,
  QuestionObjectives extends WorkspaceSnapshotLinks = WorkspaceSnapshotLinks,
  QuestionSources extends WorkspaceSnapshotGroups<WorkspaceSnapshotSourceRecord> =
    WorkspaceSnapshotGroups<WorkspaceSnapshotSourceRecord>
>({
  repositories
}: {
  repositories?: WorkspaceSnapshotRepositories<
    QuestionIds,
    Notes,
    NoteVersions,
    KnowledgeItems,
    Evidence,
    Objectives,
    Profiles,
    Focuses,
    Questions,
    QuestionObjectives,
    QuestionSources
  > | null;
} = {}) {
  if (!repositories) throw new TypeError('Workspace query repositories are required');

  return { load };

  // repositories 已由同步守卫确认；闭包内的 ! 仅补充控制流信息，不重复读取 options 或改变错误时机。
  async function load() {
    const [notes, noteVersions, knowledgeItems, evidence, objectives, profiles, focuses, questions] = await Promise.all(
      [
        repositories!.noteRepository.list({ includeDeleted: true }),
        repositories!.noteVersionRepository.list(),
        repositories!.knowledgeItemRepository.list({ includeArchived: true, includeDeleted: true }),
        repositories!.knowledgeEvidenceRepository.list(),
        repositories!.learningObjectiveRepository.list({ includeArchived: true }),
        repositories!.examProfileRepository.list({ includeArchived: true }),
        repositories!.examFocusRepository.list({ includeArchived: true }),
        repositories!.questionRepository.list({ includeArchived: true })
      ]
    );

    const questionIds = questions.map(question => question.id);
    const [questionObjectives, questionSources] = await Promise.all([
      repositories!.questionObjectiveRepository.listByQuestionIds(questionIds),
      repositories!.questionSourceRepository.list()
    ]);

    return {
      notes,
      noteVersions,
      knowledgeItems,
      evidence,
      objectives,
      profiles,
      focuses,
      questions,
      questionObjectives,
      questionSources,
      indexes: buildIndexes({
        notes,
        noteVersions,
        knowledgeItems,
        evidence,
        objectives,
        profiles,
        focuses,
        questions,
        questionObjectives,
        questionSources
      })
    };
  }
}

function buildIndexes(records: WorkspaceSnapshotIndexInput) {
  const { notes, noteVersions, evidence, objectives, focuses, questions, questionObjectives, questionSources } =
    records;
  return {
    noteById: new (Map as NativeSnapshotMap)(notes.map(note => [note.id, note])),
    noteVersionById: new (Map as NativeSnapshotMap)(noteVersions.map(version => [version.id, version])),
    evidenceByItem: groupBy(evidence, record => record.knowledgeItemId),
    objectivesByItem: groupBy(objectives, objective => objective.knowledgeItemId),
    focusByProfile: groupBy(focuses, focus => focus.examProfileId),
    linksByQuestion: groupBy<WorkspaceSnapshotLinkRecord, unknown, unknown>(
      questionObjectives,
      link => link.questionId
    ),
    sourcesByQuestion: groupBy(questionSources, source => source.questionId),
    questionsByObjective: groupQuestionsByObjective(questions, questionObjectives)
  };
}

function groupQuestionsByObjective(
  questions: WorkspaceSnapshotMap<WorkspaceSnapshotIdRecord>,
  links: WorkspaceSnapshotLinks
) {
  const questionById = new (Map as NativeSnapshotMap)(questions.map(question => [question.id, question]));
  return links.reduce((groups, link) => {
    const question = questionById.get(link.questionId);
    if (!question) return groups;
    const group = groups.get(link.learningObjectiveId) ?? [];
    group.push(question);
    groups.set(link.learningObjectiveId, group);
    return groups;
  }, new Map());
}
