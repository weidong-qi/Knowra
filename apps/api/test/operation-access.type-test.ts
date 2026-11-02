import {
  getKnowledgeOperationAccess,
  type KnowledgeOperationAccess
} from '../src/infrastructure/knowledge-operation-access.ts';
import { getKnowledgeOperationAccess as bridge } from '../src/infrastructure/knowledge-operation-access.js';
import { createMaintenanceGate, wrapHandlersWithMaintenanceGate } from '../src/infrastructure/maintenance-gate.js';
import {
  createPostgresAdvisoryLock,
  wrapHandlersWithPostgresAdvisoryLock
} from '../src/infrastructure/postgres-advisory-lock.js';
import { createAppContext } from '../src/app.factory.js';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { createAiRuntime } from '../src/modules/ai/runtime.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Assert<Value extends true> = Value;
type IsAny<Value> = 0 extends 1 & Value ? true : false;
type GateOptions = NonNullable<Parameters<typeof wrapHandlersWithMaintenanceGate>[2]>;
type LockOptions = NonNullable<Parameters<typeof wrapHandlersWithPostgresAdvisoryLock>[2]>;
type Access = NonNullable<GateOptions['getAccess']>;
type LockAccess = NonNullable<LockOptions['getAccess']>;
type Skip = NonNullable<LockOptions['skip']>;

declare const opaque: unknown;
declare const name: string;
const _result = getKnowledgeOperationAccess(opaque);
const _bridgeResult = bridge(opaque);
const _knownResult = getKnowledgeOperationAccess('createNote');
const _stringResult = getKnowledgeOperationAccess(name);
const _primitiveResults = [
  getKnowledgeOperationAccess(undefined),
  getKnowledgeOperationAccess(null),
  getKnowledgeOperationAccess(false),
  getKnowledgeOperationAccess(1),
  getKnowledgeOperationAccess(1n),
  getKnowledgeOperationAccess(Symbol('input'))
];
const _objectResult = getKnowledgeOperationAccess({ [Symbol.toPrimitive]: () => 'createNote' });
const _arrayResult = getKnowledgeOperationAccess(['listNotes']);
const callback: (name: string) => KnowledgeOperationAccess = getKnowledgeOperationAccess;
const unknownCallback: (name: unknown) => KnowledgeOperationAccess = bridge;
const gate = createMaintenanceGate();
const lock = createPostgresAdvisoryLock({});
const handlers = { createNote: () => 1, listNotes: () => Promise.resolve([]) };
// 真实默认构造和显式 undefined 必须继续编译，不改调用者或缩窄未知输入。
const _defaultGate = wrapHandlersWithMaintenanceGate(handlers, gate);
const _defaultLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock);
wrapHandlersWithMaintenanceGate(handlers, gate, undefined);
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, {});
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: undefined });
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { getAccess: undefined, skip: undefined });
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: bridge });
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { getAccess: getKnowledgeOperationAccess });
// 前批真实 AI / PG includes 回调依赖现在由既有 options JSDoc 定义为 string。
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: () => 'read' });
wrapHandlersWithMaintenanceGate(handlers, gate, {
  getAccess: name => (['upload', 'remove'].includes(name) ? 'mutation' : 'read')
});
wrapHandlersWithMaintenanceGate(handlers, gate, {
  getAccess: name => (['push', 'pushBatch', 'uploadBlob', 'bootstrap'].includes(name) ? 'mutation' : 'read')
});
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, {
  getAccess: () => opaque,
  skip: name => name.includes('delete')
});
const _local = createAppContext();
const _pg = createPostgresAppContext();
type AiRuntime = ReturnType<typeof createAiRuntime>;

export type OperationAccessContractChecks = [
  Assert<Equal<KnowledgeOperationAccess, 'mutation' | 'read'>>,
  Assert<Equal<Parameters<typeof getKnowledgeOperationAccess>, [name: unknown]>>,
  Assert<Equal<ReturnType<typeof getKnowledgeOperationAccess>, KnowledgeOperationAccess>>,
  Assert<Equal<typeof bridge, typeof getKnowledgeOperationAccess>>,
  Assert<Equal<typeof _result, KnowledgeOperationAccess>>,
  Assert<Equal<typeof _bridgeResult, KnowledgeOperationAccess>>,
  Assert<Equal<typeof _knownResult, KnowledgeOperationAccess>>,
  Assert<Equal<typeof _stringResult, KnowledgeOperationAccess>>,
  Assert<Equal<typeof _primitiveResults, KnowledgeOperationAccess[]>>,
  Assert<Equal<typeof _objectResult, KnowledgeOperationAccess>>,
  Assert<Equal<typeof _arrayResult, KnowledgeOperationAccess>>,
  Assert<Equal<IsAny<Parameters<typeof bridge>[0]>, false>>,
  Assert<Equal<IsAny<typeof _result>, false>>,
  Assert<Equal<Parameters<Access>, [name: string]>>,
  Assert<Equal<Parameters<LockAccess>, [name: string]>>,
  Assert<Equal<Parameters<Skip>, [name: string]>>,
  Assert<Equal<ReturnType<Access>, unknown>>,
  Assert<Equal<ReturnType<LockAccess>, unknown>>,
  Assert<Equal<ReturnType<Skip>, unknown>>,
  Assert<Equal<GateOptions, { getAccess?: ((name: string) => unknown) | undefined }>>,
  Assert<
    Equal<
      LockOptions,
      { getAccess?: ((name: string) => unknown) | undefined; skip?: ((name: string) => unknown) | undefined }
    >
  >,
  // 维护门保留参数并显式返回异步结果；其余旧 JS 端口仍保留原断言。
  Assert<Equal<(typeof _defaultGate)['createNote'], () => Promise<number>>>,
  Assert<Equal<IsAny<(typeof _defaultLock)['listNotes']>, true>>,
  Assert<Equal<IsAny<typeof _local.dataStore>, true>>,
  Assert<Equal<IsAny<typeof _pg>, false>>,
  Assert<Equal<IsAny<AiRuntime>, false>>
];
void [callback, unknownCallback];
