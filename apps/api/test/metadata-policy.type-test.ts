import {
  ATTACHMENT_STATUS,
  ATTACHMENT_STATUS_VALUES,
  isAttachmentStatus,
  normalizeAttachmentStatus,
  type AttachmentStatus
} from '../src/infrastructure/attachment-status.ts';
import {
  isAttachmentStatus as bridgePredicate,
  normalizeAttachmentStatus as bridgeNormalize
} from '../src/infrastructure/attachment-status.js';
import { inspectAttachmentIntegrity, buildAttachmentRepairRecord } from '../src/infrastructure/attachment-integrity.js';
import { validateAttachmentSnapshotItems } from '../src/infrastructure/local-attachment-snapshot-validator.js';
import { createLocalAttachmentStore } from '../src/infrastructure/local-attachment-store.js';
import { createPostgresAttachmentStore } from '../src/infrastructure/postgres-attachment-store.js';
import { createLocalAttachmentUpload } from '../src/infrastructure/local-attachment-upload.js';
import { reconcileAttachmentIntegrity } from '../src/infrastructure/attachment-record-reconciliation.js';
import { validatePersistedLocalState, createEmptyLocalState } from '../src/infrastructure/local-data-schema.js';
import { transformAttachment } from '../src/infrastructure/migration/json-transformers.js';
import { createAppContext } from '../src/app.factory.js';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Assert<Value extends true> = Value;
type IsAny<Value> = 0 extends 1 & Value ? true : false;

declare const unknownValue: unknown;
declare const fallback: { readonly token: symbol };
declare const optionalFallback: typeof fallback | undefined;
declare const unknownFallback: unknown;
declare const statusValue: AttachmentStatus;
const _boolean = isAttachmentStatus(unknownValue);
const _bridgeBoolean = bridgePredicate(Symbol('input'));
const _unknownDefault = normalizeAttachmentStatus(unknownValue);
const _unknownFallback = normalizeAttachmentStatus(unknownValue, fallback);
const _known = normalizeAttachmentStatus(statusValue);
const _string = normalizeAttachmentStatus('legacy' as string);
const _number = normalizeAttachmentStatus(3 as number);
const _undefined = normalizeAttachmentStatus(undefined);
const _null = normalizeAttachmentStatus(null);
const _false = normalizeAttachmentStatus(false as const);
const _symbol = normalizeAttachmentStatus(Symbol('input'));
const _bigint = normalizeAttachmentStatus(3n as bigint);
const _explicitUndefined = normalizeAttachmentStatus(3 as number, undefined);
const _objectFallback = normalizeAttachmentStatus(statusValue, fallback);
const _optionalFallback = normalizeAttachmentStatus(statusValue, optionalFallback);
const _nullFallback = normalizeAttachmentStatus(statusValue, null);
const _falseFallback = normalizeAttachmentStatus(statusValue, false as const);
const _numberFallback = normalizeAttachmentStatus(statusValue, 0 as number);
const _symbolFallback = normalizeAttachmentStatus(statusValue, Symbol('fallback'));
const _unknownSecond = normalizeAttachmentStatus(statusValue, unknownFallback);
const _bothUnknown = normalizeAttachmentStatus(unknownValue, unknownFallback);
const _bridgeUnknown = bridgeNormalize(unknownValue, fallback);
const _bridgeKnown = bridgeNormalize(statusValue, optionalFallback);
const objectValue = { historical: true };
const _objectValue = normalizeAttachmentStatus(objectValue, fallback);
const _readonlyFallback = normalizeAttachmentStatus(statusValue, Object.freeze([1, 2]));

// 既有 JS 消费者的实际入口编译；这不是把存量 any 端口宣称为完整类型安全。
const _state = createEmptyLocalState();
const _persisted = validatePersistedLocalState({ schemaVersion: 7, ..._state });
const _snapshot = validateAttachmentSnapshotItems([], {});
const _integrity = inspectAttachmentIntegrity({ attachments: [], generatedAt: 'synthetic' });
const _repair = buildAttachmentRepairRecord({}, { observedStatus: ATTACHMENT_STATUS.READY });
const _reconciled = reconcileAttachmentIntegrity({}, null, { now: 'synthetic' });
const _upload = createLocalAttachmentUpload({ dataStore: {}, fileManager: {}, flush: () => undefined });
const _uploaded = _upload({ noteId: 'n', fileName: 'file', contentBase64: 'eA==' });
const _store = createLocalAttachmentStore({ dataStore: {} });
const _pgStore = createPostgresAttachmentStore();
const _localContext = createAppContext();
const _pgContext = createPostgresAppContext();

export type MetadataPolicyContractChecks = [
  Assert<Equal<AttachmentStatus, 'pending' | 'ready' | 'missing' | 'corrupt' | 'failed'>>,
  Assert<Equal<typeof ATTACHMENT_STATUS.READY, 'ready'>>,
  Assert<Equal<typeof ATTACHMENT_STATUS_VALUES, readonly AttachmentStatus[]>>,
  Assert<Equal<Parameters<typeof isAttachmentStatus>, [value: unknown]>>,
  Assert<Equal<ReturnType<typeof isAttachmentStatus>, boolean>>,
  Assert<Equal<typeof _boolean, boolean>>,
  Assert<Equal<typeof _bridgeBoolean, boolean>>,
  Assert<Equal<typeof _unknownDefault, unknown>>,
  Assert<Equal<typeof _unknownFallback, unknown>>,
  Assert<Equal<typeof _known, AttachmentStatus>>,
  Assert<Equal<typeof _string, string>>,
  Assert<Equal<typeof _number, number | 'ready'>>,
  Assert<Equal<typeof _undefined, undefined | 'ready'>>,
  Assert<Equal<typeof _null, null | 'ready'>>,
  Assert<Equal<typeof _false, false | 'ready'>>,
  Assert<Equal<typeof _symbol, symbol | 'ready'>>,
  Assert<Equal<typeof _bigint, bigint | 'ready'>>,
  Assert<Equal<typeof _explicitUndefined, number | 'ready'>>,
  Assert<Equal<typeof _objectFallback, AttachmentStatus | typeof fallback>>,
  Assert<Equal<typeof _optionalFallback, AttachmentStatus | typeof fallback>>,
  Assert<Equal<typeof _nullFallback, AttachmentStatus | null>>,
  Assert<Equal<typeof _falseFallback, AttachmentStatus | false>>,
  Assert<Equal<typeof _numberFallback, AttachmentStatus | number>>,
  Assert<Equal<typeof _symbolFallback, AttachmentStatus | symbol>>,
  Assert<Equal<typeof _unknownSecond, unknown>>,
  Assert<Equal<typeof _bothUnknown, unknown>>,
  Assert<Equal<typeof _bridgeUnknown, unknown>>,
  Assert<Equal<typeof _bridgeKnown, AttachmentStatus | typeof fallback>>,
  Assert<Equal<typeof _objectValue, typeof objectValue | typeof fallback>>,
  Assert<Equal<typeof _readonlyFallback, AttachmentStatus | readonly number[]>>,
  Assert<Equal<IsAny<typeof _unknownDefault>, false>>,
  Assert<Equal<IsAny<typeof _objectFallback>, false>>,
  Assert<Equal<typeof _reconciled, boolean>>,
  Assert<Equal<typeof _integrity.generatedAt, string>>,
  Assert<Equal<typeof _integrity.canServe, boolean>>,
  Assert<Equal<IsAny<(typeof _integrity.items)[number]['storedStatus']>, true>>,
  Assert<Equal<IsAny<typeof _repair>, true>>,
  Assert<Equal<IsAny<typeof _snapshot>, true>>,
  Assert<Equal<IsAny<typeof _persisted>, true>>,
  Assert<Equal<IsAny<ReturnType<typeof _store.getAttachment>>, true>>,
  Assert<Equal<IsAny<Awaited<ReturnType<typeof _pgStore.getAttachment>>>, true>>,
  Assert<Equal<IsAny<typeof _localContext.dataStore>, true>>,
  Assert<Equal<IsAny<typeof _pgContext>, false>>,
  // 上传过程可进入所有已声明的附件状态。
  Assert<Equal<typeof _uploaded.status, AttachmentStatus>>,
  // 原 JS 在严格源码推断下的该输入为 never，发射声明却为 any；两种边界均另行核对。
  Assert<Equal<Parameters<typeof transformAttachment>[0], never>>
];

// 每条 expect-error 都另行移除后编译并核对精确诊断行，避免未执行的负例。
// @ts-expect-error 未知输入不能被 normalization 冒充已验证状态。
const _unsafeStatus: AttachmentStatus = normalizeAttachmentStatus(unknownValue);
// @ts-expect-error 未知 fallback 仍未知。
const _unsafeFallback: AttachmentStatus = normalizeAttachmentStatus(statusValue, unknownFallback);
// @ts-expect-error unknown 不能变成字符串。
const _unsafeString: string = bridgeNormalize(unknownValue);
// @ts-expect-error 布尔函数不是状态类型谓词。
const _predicate: (value: unknown) => value is AttachmentStatus = isAttachmentStatus;
if (isAttachmentStatus(unknownValue)) {
  // @ts-expect-error 布尔返回不收窄调用方 unknown。
  const _notNarrowed: AttachmentStatus = unknownValue;
  void _notNarrowed;
}
// @ts-expect-error 任意对象 fallback 必须保留。
const _lostObject: AttachmentStatus = _objectFallback;
// @ts-expect-error number 输入的保守结果不谎称只是 ready。
const _lostValue: 'ready' = _number;
// @ts-expect-error undefined fallback 使用 ready 默认，不返回只有 number。
const _lostDefault: number = _explicitUndefined;
// @ts-expect-error false fallback 不能消失。
const _lostFalse: AttachmentStatus = _falseFallback;
// @ts-expect-error null fallback 不能消失。
const _lostNull: AttachmentStatus = _nullFallback;
// @ts-expect-error 原始 Symbol 输入不接受字符串结果保证。
const _lostSymbol: string = _symbol;
// @ts-expect-error 冻结状态常量只读。
ATTACHMENT_STATUS.READY = 'ready';
// @ts-expect-error 冻结列表不允许 push。
ATTACHMENT_STATUS_VALUES.push('ready');
// @ts-expect-error 无新增状态。
const _newStatus: AttachmentStatus = 'unknown';
// @ts-expect-error 需要一个输入参数，即使它允许 undefined。
isAttachmentStatus();
// @ts-expect-error normalize 需要输入参数。
normalizeAttachmentStatus();
// @ts-expect-error 旧公开函数不接受第三参数。
normalizeAttachmentStatus(statusValue, fallback, 'extra');
// @ts-expect-error 真实本地消费者仍要求 dataStore 参数。
createLocalAttachmentStore({});
// @ts-expect-error 真实上传接口仍要求 fileName。
_upload({ noteId: 'n', contentBase64: 'eA==' });
// @ts-expect-error 真实完整性接口仍要求字符串时间。
inspectAttachmentIntegrity({ generatedAt: 1 });
// @ts-expect-error 旧 JS 解构推断遗漏 fileManager；保留真实边界，不声称端到端接线安全。
inspectAttachmentIntegrity({ fileManager: {} });
// @ts-expect-error 旧 PG 解构推断遗漏 attachmentRepository；本批不重写此边界。
createPostgresAttachmentStore({ attachmentRepository: {} });
// @ts-expect-error 旧上传状态声明不能冒充已验证 ready。
const _legacyUploadReady: 'ready' = _uploaded.status;

void [
  _unsafeStatus,
  _unsafeFallback,
  _unsafeString,
  _predicate,
  _lostObject,
  _lostValue,
  _lostDefault,
  _lostFalse,
  _lostNull,
  _lostSymbol,
  _newStatus,
  _legacyUploadReady
];
