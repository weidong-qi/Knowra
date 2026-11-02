import { createEmptyTaskWorkspaceSnapshot, createJsonTaskWorkspaceStore } from './task-workspace-json-store.ts';
import {
  validateTaskWorkspaceSnapshot,
  rebindTaskWorkspaceSnapshot
} from '../modules/task-workspaces/storage-validation.ts';
import { createJsonActionStore } from '../modules/ai/action-state.js';
import {
  planHistoryRetention,
  applyHistoryRetentionPlan,
  changedHistoryNoteIds,
  historyRetentionBasis,
  HISTORY_RETENTION_COLLECTIONS
} from '../modules/knowledge/domain/history-retention.js';
import { extractionPageRows } from '../modules/ai/knowledge-extraction-task-page.ts';
import {
  taskKey,
  validateExtractionTask,
  validateExtractionTaskState
} from '../modules/ai/knowledge-extraction-task-contract.js';
import {
  knowledgeExtractionCommitKey,
  validateKnowledgeExtractionCommit,
  validateKnowledgeExtractionCommitState
} from '../modules/ai/knowledge-extraction-commit-contract.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../errors/app-error.js';
import { writeJsonFileAtomically } from './atomic-json-file.ts';
import { withDataFileWriteLock } from './data-file-write-lock.ts';
import { cloneJsonData } from './json-clone.ts';
import { readJsonFileSync } from './json-file-reader.ts';
import { coreOperationKey, validateCoreOperationState } from './core-operation-contract.ts';
import { createSyncCoreOperationStore } from './core-operation-store.ts';
import {
  backfillKnowledgeArtifactProvenance,
  legacyKnowledgeExtractionReceipts
} from './migration/knowledge-artifact-provenance-backfill.js';
import { assertNoKnowledgeArtifactProvenanceDowngrade } from '../modules/knowledge/domain/knowledge-artifact-provenance-state.js';
import {
  appendChanges,
  createJournal,
  createSyncBaseline,
  cloneJournalForChanges,
  loadJournal,
  syncKey
} from '../modules/sync/journal.ts';
import {
  createJsonAiAccessStore,
  createJsonAiConversationStore,
  createJsonAiRepository,
  validateAiState
} from '../modules/ai/record-state.ts';
import { createJsonBudgetAuthority } from '../modules/ai/budget-ledger.js';
import {
  LOCAL_DATA_COLLECTIONS,
  LOCAL_DATA_SCHEMA_VERSION,
  LOCAL_SNAPSHOT_VERSION,
  cloneLocalState,
  createEmptyLocalState,
  createPersistedLocalDocument,
  validateLocalSnapshot,
  assertPersistedLocalState,
  validatePersistedLocalState
} from './local-data-schema.js';

/** @typedef {ReturnType<typeof validateCoreOperationState>} CoreOperationState */
/** @typedef {ReturnType<typeof validateKnowledgeExtractionCommitState>} ExtractionCommitState */
/** @typedef {ReturnType<typeof validateExtractionTaskState>} ExtractionTaskState */
/** @typedef {import('../modules/task-workspaces/repository-port.ts').TaskWorkspaceSnapshot} TaskWorkspaceSnapshot */
// 旧 JS 校验器接受原始 JSON；默认参数的推断类型不代表输入已校验。
/** @typedef {(input?: unknown) => CoreOperationState} CoreOperationStateParser */
/** @typedef {(input?: unknown) => ExtractionCommitState} ExtractionCommitStateParser */
/** @typedef {(input?: unknown) => ExtractionTaskState} ExtractionTaskStateParser */

function ensureParentDirectory(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function replaceCollection(target, source) {
  target.splice(0, target.length, ...source);
}

export function createFileDataStore(filePath, { writeJson = writeJsonFileAtomically, maintenanceToken = null } = {}) {
  ensureParentDirectory(filePath);
  const identity = () => {
    try {
      const stat = fs.statSync(filePath, { bigint: true });
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  let diskIdentity = identity();
  // 仅给既有转发绑定配对完整调用元组；不使用重载 Parameters 的最后签名代替全部调用。
  /**
   * @template D
   * @typedef {[filePath: string, value: unknown, options?: import('./atomic-json-file.ts').Options<number> | undefined] | [filePath: string, value: unknown, options: import('./atomic-json-file.ts').Hooks & { fileSystem: import('./atomic-json-file.ts').FilePort<D> }]} AtomicWriteArguments
   */
  /** @type {<D>(...args: AtomicWriteArguments<D>) => void} */
  const write = writeJson;
  /** @template D @param {AtomicWriteArguments<D>} args */
  writeJson = (...args) =>
    withDataFileWriteLock(filePath, maintenanceToken, () => {
      if (identity() !== diskIdentity)
        throw createAppError(
          'STORAGE_EXTERNAL_CHANGE',
          '资料库已由另一进程修改，请重新加载后再保存；未覆盖新数据。',
          409
        );
      const result = write(...args);
      diskIdentity = identity();
      return result;
    });

  if (!fs.existsSync(filePath)) {
    assertNoInterruptedReplacement(filePath);
    writeJson(filePath, createPersistedLocalDocument(createEmptyLocalState()));
  }

  const parsedInput = parsePersistedState(filePath);
  const state = validatePersistedLocalState(parsedInput);
  // 既有校验已确认顶层为对象；各扩展仍保持未校验输入类型并独立校验。
  const parsed = /** @type {Record<string, unknown>} */ (parsedInput);
  // 独立扩展不加入普通笔记 collections、搜索或 sync；坏数据原样保留。
  let taskWorkspaces = parsed.taskWorkspaces === undefined ? createEmptyTaskWorkspaceSnapshot() : parsed.taskWorkspaces;
  let taskWorkspaceStoreError = null;
  try {
    validateTaskWorkspaceSnapshot(taskWorkspaces);
  } catch (error) {
    taskWorkspaceStoreError = error;
  }
  let coreOperations = parsed.coreOperations;
  let coreOperationStoreError = null;
  try {
    coreOperations = /** @type {CoreOperationStateParser} */ (validateCoreOperationState)(coreOperations);
  } catch (error) {
    coreOperationStoreError = error;
  }
  let knowledgeExtractionCommits = parsed.knowledgeExtractionCommits;
  let knowledgeExtractionCommitStoreError = null;
  try {
    knowledgeExtractionCommits = /** @type {ExtractionCommitStateParser} */ (validateKnowledgeExtractionCommitState)(
      knowledgeExtractionCommits
    );
  } catch (error) {
    knowledgeExtractionCommitStoreError = error;
  }
  let extractionTasks = parsed.aiKnowledgeExtractionTasks;
  let knowledgeExtractionTaskStoreError = null;
  try {
    extractionTasks = /** @type {ExtractionTaskStateParser} */ (validateExtractionTaskState)(extractionTasks);
  } catch (error) {
    knowledgeExtractionTaskStoreError = error;
  }
  let aiRuntime;
  let aiRuntimeError = null;
  try {
    aiRuntime = validateAiState(parsed.aiRuntime);
  } catch (error) {
    // 保留损坏的 AI 原文，核心事务继续原子写入；不能把坏记录当成空白 AI 数据覆盖。
    aiRuntime = parsed.aiRuntime;
    aiRuntimeError = error;
  }
  let journal = loadJournal(parsed.sync, state);
  const provenanceMigration = backfillKnowledgeArtifactProvenance(state, {
    receipts: legacyKnowledgeExtractionReceipts(parsed.knowledgeExtractionCommits),
    getTombstone: (collection, id) => journal.tombstones?.[syncKey(collection, id)]
  });
  for (const record of state.knowledgeArtifactProvenance) {
    if (journal.tombstones?.[syncKey('knowledgeArtifactProvenance', record.id)]) {
      throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT', '已永久删除的来源记录不能通过迁移重建。', 409);
    }
  }
  let committed = createSyncBaseline(state);
  let historyBasis = historyRetentionBasis(state);
  let transaction = null;
  if (
    parsed.taskWorkspaces === undefined ||
    parsed.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION ||
    ['knowledgeItems', 'knowledgeEvidence', 'knowledgeArtifactProvenance'].some(
      collection => JSON.stringify(parsed[collection] ?? []) !== JSON.stringify(state[collection])
    )
  ) {
    const previous = Object.fromEntries(
      LOCAL_DATA_COLLECTIONS.map(collection => [
        collection,
        cloneJsonData(/** @type {{id: string}[] | undefined} */ (parsed[collection]) ?? [])
      ])
    );
    journal = appendChanges(journal, previous, state);
    writeJson(filePath, {
      ...createPersistedLocalDocument(state),
      sync: journal,
      aiRuntime,
      coreOperations,
      knowledgeExtractionCommits,
      aiKnowledgeExtractionTasks: extractionTasks,
      taskWorkspaces
    });
  }

  function flush() {
    if (transaction) {
      transaction.dirty = true;
      return;
    }
    persistState(state);
  }

  /**
   * @param operation
   * @param {{beforeCommit?: () => void}} options */
  function runTransaction(operation, { beforeCommit } = {}) {
    if (typeof operation !== 'function') {
      throw new TypeError('Storage transaction operation must be a function');
    }

    if (transaction) {
      if (beforeCommit) (transaction.commitGuards ??= []).push(beforeCommit);
      return operation();
    }

    const previousState = cloneLocalState(state);
    const previousAiRuntime = cloneJsonData(aiRuntime);
    const previousTaskWorkspaces = cloneJsonData(taskWorkspaces);
    const previousCoreOperations = cloneJsonData(coreOperations);
    const previousExtractionCommits = cloneJsonData(knowledgeExtractionCommits);
    const previousExtractionTasks = cloneJsonData(extractionTasks);
    const previousJournal = cloneJsonData(journal);
    transaction = { dirty: false, afterCommit: [], commitGuards: beforeCommit ? [beforeCommit] : [] };
    let committedCallbacks = [];

    try {
      const result = operation();
      if (result && typeof result.then === 'function') {
        throw new TypeError('Local storage transactions must be synchronous');
      }
      if (transaction.dirty) {
        persistState(state);
      }
      committedCallbacks = transaction.afterCommit;
      return result;
    } catch (error) {
      replaceState(state, previousState);
      aiRuntime = previousAiRuntime;
      taskWorkspaces = previousTaskWorkspaces;
      coreOperations = previousCoreOperations;
      knowledgeExtractionCommits = previousExtractionCommits;
      extractionTasks = previousExtractionTasks;
      journal = previousJournal;
      throw error;
    } finally {
      transaction = null;
      for (const callback of committedCallbacks) {
        try {
          callback();
        } catch {
          /* 提交后回调失败不能撤销已经完成的写入。 */
        }
      }
    }
  }

  /** 在最外层事务成功写入后执行；回滚时丢弃，不在事务中则立即执行。 */
  function afterCommit(callback) {
    if (transaction) {
      transaction.afterCommit.push(callback);
      return;
    }
    try {
      callback();
    } catch {
      /* 同上 */
    }
  }

  function exportSnapshot() {
    return {
      exportedAt: new Date().toISOString(),
      version: LOCAL_SNAPSHOT_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      data: cloneLocalState(state)
    };
  }

  // 仅供批量同步：领域层在独立后像中工作，applyState 只替换集合，不原地修改旧记录。
  // 普通业务及旧版笔记同步仍使用完整前像事务，不能复用此路径。
  function runSyncBatchTransaction(operation) {
    if (transaction) throw new TypeError('批量同步必须拥有最外层事务。');
    const previousState = Object.fromEntries(
      LOCAL_DATA_COLLECTIONS.map(collection => [collection, [...state[collection]]])
    );
    const previousJournal = journal;
    journal = {
      ...cloneJournalForChanges(journal),
      receipts: { ...journal.receipts },
      deviceSequences: { ...journal.deviceSequences }
    };
    transaction = { dirty: true, skipHistoryRetention: true };
    try {
      const result = operation();
      if (result && typeof result.then === 'function') throw new TypeError('批量同步事务必须同步。');
      persistState(state);
      return result;
    } catch (error) {
      replaceState(state, previousState);
      journal = previousJournal;
      throw error;
    } finally {
      transaction = null;
    }
  }

  // 仅供传输快照缓存使用：业务实体、修订和删除事实在该事务内只读。
  function runSyncJournalTransaction(operation) {
    if (transaction) throw new TypeError('同步快照缓存必须拥有最外层事务。');
    const candidate = appendChanges(cloneJsonData(journal), committed, state);
    // 兼容尚未 flush 的内部业务写入；先走完整校验与提交，不能把未登记实体藏在快照外。
    if (candidate.head !== journal.head) {
      return runTransaction(() => {
        const result = operation();
        flush();
        return result;
      });
    }
    const previousJournal = journal;
    journal = candidate;
    try {
      const result = operation();
      if (result && typeof result.then === 'function') throw new TypeError('快照缓存事务必须同步。');
      writeJson(filePath, {
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
        ...state,
        sync: journal,
        aiRuntime,
        coreOperations,
        knowledgeExtractionCommits,
        aiKnowledgeExtractionTasks: extractionTasks,
        taskWorkspaces
      });
      return result;
    } catch (error) {
      journal = previousJournal;
      throw error;
    }
  }

  function prepareImport(snapshot) {
    return validateLocalSnapshot(snapshot);
  }

  function commitImport(preparedSnapshot) {
    const validated = validateLocalSnapshot(preparedSnapshot);
    assertNoKnowledgeArtifactProvenanceDowngrade(state, validated.data);
    for (const collection of LOCAL_DATA_COLLECTIONS) {
      for (const item of validated.data[collection]) {
        if (journal.tombstones?.[syncKey(collection, item.id)]) {
          throw createAppError('IMPORT_DELETED_ID', '旧备份包含已经永久删除的对象，请使用新的资产 ID 导入。', 409, {
            collection,
            id: item.id
          });
        }
      }
    }
    const previousJournal = journal;
    journal = createJournal(validated.data);
    journal.tombstones = structuredClone(previousJournal.tombstones ?? {});
    for (const [key, tombstone] of Object.entries(journal.tombstones)) {
      journal.revisions[key] = tombstone.revision;
    }
    const previousAiRuntime = aiRuntime;
    const previousTaskWorkspaces = taskWorkspaces;
    try {
      if (!taskWorkspaceStoreError)
        taskWorkspaces = rebindTaskWorkspaceSnapshot(/** @type {TaskWorkspaceSnapshot} */ (taskWorkspaces), {
          datasetId: /** @type {TaskWorkspaceSnapshot} */ (taskWorkspaces).datasetId,
          datasetEpoch: randomUUID()
        });
      aiRuntime = { ...aiRuntime, datasetEpoch: randomUUID() };
      persistState(validated.data);
    } catch (error) {
      journal = previousJournal;
      aiRuntime = previousAiRuntime;
      taskWorkspaces = previousTaskWorkspaces;
      throw error;
    }
    replaceState(state, validated.data);
    return exportSnapshot();
  }

  function importSnapshot(snapshot) {
    return commitImport(prepareImport(snapshot));
  }

  function persistState(nextState) {
    try {
      const noteIds = changedHistoryNoteIds(historyBasis, nextState);
      const references = getHistoryRetentionReferences();
      if (!transaction?.skipHistoryRetention && noteIds.size && references !== null) {
        const retained = applyHistoryRetentionPlan(
          nextState,
          planHistoryRetention(nextState, { noteIds, externalReferences: references })
        );
        for (const name of HISTORY_RETENTION_COLLECTIONS) replaceCollection(nextState[name], retained[name]);
      }
      // 只用于断言；不可变历史在校验期间只读，不再产生随即丢弃的整库历史副本。
      assertPersistedLocalState({ schemaVersion: LOCAL_DATA_SCHEMA_VERSION, ...nextState });
      assertNoKnowledgeArtifactProvenanceDowngrade(committed, nextState);
      const nextJournal = appendChanges(cloneJournalForChanges(journal), committed, nextState);
      const nextCommitted = createSyncBaseline(nextState);
      // 原子写入器同步序列化且不修改输入，写入期间保留事务回滚前像。
      writeJson(
        filePath,
        {
          schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
          ...nextState,
          sync: nextJournal,
          taskWorkspaces,
          aiRuntime: aiRuntimeError ? aiRuntime : validateAiState(aiRuntime),
          coreOperations: coreOperationStoreError
            ? coreOperations
            : /** @type {CoreOperationStateParser} */ (validateCoreOperationState)(coreOperations),
          knowledgeExtractionCommits: knowledgeExtractionCommitStoreError
            ? knowledgeExtractionCommits
            : /** @type {ExtractionCommitStateParser} */ (validateKnowledgeExtractionCommitState)(
                knowledgeExtractionCommits
              ),
          aiKnowledgeExtractionTasks: knowledgeExtractionTaskStoreError
            ? extractionTasks
            : /** @type {ExtractionTaskStateParser} */ (validateExtractionTaskState)(extractionTasks)
        },
        {
          beforeCommit: () => {
            for (const guard of transaction?.commitGuards ?? []) {
              const result = guard();
              if (result === false) throw createAppError('TASK_WORKSPACE_FORBIDDEN', '任务工作区操作授权已失效。', 403);
              if (result?.then) throw new TypeError('Local storage commit guard must be synchronous');
            }
          }
        }
      );
      journal = nextJournal;
      committed = nextCommitted;
      historyBasis = historyRetentionBasis(nextState);
    } catch (error) {
      if (error?.code?.startsWith('TASK_WORKSPACE_')) throw error;
      throw createAppError('STORAGE_WRITE_FAILED', 'Failed to persist local data safely', 500, { cause: error });
    }
  }

  function getHistoryRetentionReferences() {
    if (
      aiRuntimeError ||
      coreOperationStoreError ||
      knowledgeExtractionTaskStoreError ||
      knowledgeExtractionCommitStoreError
    )
      return null;
    return [aiRuntime, coreOperations, knowledgeExtractionCommits, extractionTasks];
  }

  return {
    taskWorkspaceStore: taskWorkspaceStoreError
      ? null
      : createJsonTaskWorkspaceStore({
          readState: () => {
            // 其他进程恢复/替换文件后，旧实例不能继续读旧 epoch 的缓存资料或回执。
            // 保守关闭本域并要求重新打开；不改变普通笔记的读取和同步协议。
            if (identity() !== diskIdentity) {
              throw createAppError('TASK_WORKSPACE_CONFLICT', '任务工作区资料库已变化，请重新加载后再操作。', 409);
            }
            return taskWorkspaces;
          },
          writeState: next => {
            taskWorkspaces = next;
            flush();
          },
          transaction: runTransaction
        }),
    taskWorkspaceStoreError,
    getHistoryRetentionReferences,
    provenanceMigration,
    // Internal, synchronous snapshot of every retained dataset; never hide unreadable private records.
    getPurgeTaskState() {
      if (aiRuntimeError || knowledgeExtractionTaskStoreError || knowledgeExtractionCommitStoreError) {
        throw new Error('持久化任务或提炼历史不可读，无法核查清理引用。');
      }
      return structuredClone({
        ai: aiRuntime,
        tasks: /** @type {ExtractionTaskState} */ (extractionTasks).tasks,
        receipts: /** @type {ExtractionCommitState} */ (knowledgeExtractionCommits).receipts
      });
    },
    knowledgeExtractionTaskStore: knowledgeExtractionTaskStoreError
      ? null
      : {
          supportsAsync: false,
          runTransaction(operation) {
            if (transaction) throw new TypeError('提炼任务必须拥有最外层事务。');
            return runTransaction(operation);
          },
          get: input =>
            structuredClone(
              /** @type {ExtractionTaskState} */ (extractionTasks).tasks.find(
                task => taskKey(task) === taskKey(input)
              ) ?? null
            ),
          list: input =>
            /** @type {ExtractionTaskState} */ (extractionTasks).tasks
              .filter(task => task.ownerId === input.ownerId && task.datasetId === input.datasetId)
              .map(task => structuredClone(task)),
          listPage: input =>
            extractionPageRows(
              aiRuntime.jobs,
              new Set(
                /** @type {ExtractionTaskState} */ (extractionTasks).tasks
                  .filter(
                    task =>
                      task.ownerId === input.ownerId &&
                      task.datasetId === input.datasetId &&
                      task.datasetEpoch === input.datasetEpoch
                  )
                  .map(task => task.jobId)
              ),
              input
            ),
          insert(task) {
            const record = validateExtractionTask(task);
            if (
              /** @type {ExtractionTaskState} */ (extractionTasks).tasks.some(task => taskKey(task) === taskKey(record))
            )
              throw new Error('提炼任务描述已存在。');
            /** @type {ExtractionTaskState} */ (extractionTasks).tasks.push(record);
            flush();
          }
        },
    knowledgeExtractionTaskStoreError,
    knowledgeExtractionCommitStore: knowledgeExtractionCommitStoreError
      ? null
      : {
          supportsAsync: false,
          runTransaction(operation) {
            if (transaction) throw new TypeError('提炼接纳必须拥有最外层事务，不能嵌套提交。');
            return runTransaction(operation);
          },
          get: input =>
            structuredClone(
              /** @type {ExtractionCommitState} */ (knowledgeExtractionCommits).receipts.find(
                receipt => knowledgeExtractionCommitKey(receipt) === knowledgeExtractionCommitKey(input)
              ) ?? null
            ),
          insert: receipt => {
            /** @type {ExtractionCommitState} */ (knowledgeExtractionCommits).receipts.push(
              validateKnowledgeExtractionCommit(receipt)
            );
            flush();
          }
        },
    knowledgeExtractionCommitStoreError,
    coreOperationStore: coreOperationStoreError
      ? null
      : createSyncCoreOperationStore({
          transaction: operation => {
            if (transaction) throw new TypeError('核心操作必须拥有最外层事务，不能嵌套提交。');
            return runTransaction(operation);
          },
          get: input =>
            /** @type {CoreOperationState} */ (coreOperations).receipts.find(
              receipt => coreOperationKey(receipt) === coreOperationKey(input)
            ) ?? null,
          insert: receipt => {
            /** @type {CoreOperationState} */ (coreOperations).receipts.push(receipt);
            flush();
          }
        }),
    coreOperationStoreError,
    aiRepository: aiRuntimeError
      ? null
      : createJsonAiRepository({ getState: () => aiRuntime, runTransaction, onChange: flush }),
    aiAccessStore: aiRuntimeError
      ? null
      : createJsonAiAccessStore({ getState: () => aiRuntime, runTransaction, onChange: flush }),
    aiActionStore: aiRuntimeError
      ? null
      : createJsonActionStore({ getState: () => aiRuntime, runTransaction, onChange: flush }),
    aiConversationStore: aiRuntimeError
      ? null
      : createJsonAiConversationStore({ getState: () => aiRuntime, runTransaction, onChange: flush }),
    aiBudgetAuthority: aiRuntimeError
      ? null
      : createJsonBudgetAuthority({ getState: () => aiRuntime, runTransaction, onChange: flush }),
    aiRuntimeError,
    getSyncJournal: () => journal,
    previewSyncJournal: () => appendChanges(cloneJournalForChanges(journal), committed, state),
    runSyncTransaction: operation =>
      runTransaction(() => {
        const result = operation();
        flush();
        return result;
      }),
    runSyncBatchTransaction,
    runSyncJournalTransaction,
    state,
    flush,
    runTransaction,
    afterCommit,
    exportSnapshot,
    prepareImport,
    commitImport,
    importSnapshot
  };
}

function assertNoInterruptedReplacement(filePath) {
  const prefix = `.${path.basename(filePath)}.`;
  const recoveryFiles = fs
    .readdirSync(path.dirname(filePath))
    .filter(name => name.startsWith(prefix) && /\.(bak|tmp)$/.test(name));
  if (recoveryFiles.length > 0) {
    throw createAppError(
      'STORAGE_RECOVERY_REQUIRED',
      `检测到未完成的数据文件替换，已停止创建空库。请保留整个数据目录，核验并恢复 ${path.basename(filePath)} 后重试。恢复候选：${recoveryFiles.sort().join('、')}`,
      500
    );
  }
}

function parsePersistedState(filePath) {
  try {
    const parsed = readJsonFileSync(filePath, { allowEmpty: true });
    return parsed === undefined ? createEmptyLocalState() : parsed;
  } catch (error) {
    throw createAppError('STORAGE_DATA_INVALID', 'Local data file contains invalid JSON', 500, { cause: error });
  }
}

function replaceState(target, source) {
  for (const collectionName of LOCAL_DATA_COLLECTIONS) {
    replaceCollection(target[collectionName], source[collectionName]);
  }
}
