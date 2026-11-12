import { createKnowledgeWorkspaceQuery } from './knowledge-workspace-query-service.ts';
import { createReviewQueueQuery } from './review-queue-query-service.ts';
import { createTrainingWorkspaceQuery } from './training-workspace-query-service.ts';
import { createWorkspaceSnapshotReader } from './workspace-query-snapshot.ts';

import type {
  WorkspaceSnapshotRepositories,
  WorkspaceSnapshotMap,
  WorkspaceSnapshotIdRecord,
  WorkspaceSnapshotGroups,
  WorkspaceSnapshotItemRecord,
  WorkspaceSnapshotFocusRecord,
  WorkspaceSnapshotLinks,
  WorkspaceSnapshotSourceRecord
} from './workspace-query-snapshot.ts';

// 与快照工厂共享输入约束与默认值；QuestionIds 不收窄，也不在转发处断言仓库。
export function createWorkspaceQueryService<
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
  const snapshotReader = createWorkspaceSnapshotReader({ repositories });
  const knowledgeQuery = createKnowledgeWorkspaceQuery({ snapshotReader });
  const trainingQuery = createTrainingWorkspaceQuery({ snapshotReader });
  const reviewQuery = createReviewQueueQuery({ snapshotReader });

  return {
    ...knowledgeQuery,
    ...trainingQuery,
    ...reviewQuery
  };
}
