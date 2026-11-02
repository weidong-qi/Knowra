import { createMaintenanceGate, wrapHandlersWithMaintenanceGate } from '../src/infrastructure/maintenance-gate.js';
import {
  createPostgresAdvisoryLock,
  wrapHandlersWithPostgresAdvisoryLock
} from '../src/infrastructure/postgres-advisory-lock.js';
import { getKnowledgeOperationAccess } from '../src/infrastructure/knowledge-operation-access.js';
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

declare const unknownValue: unknown;
declare const name: string;
declare const optionalName: string | undefined;
declare const access: Access;
declare const skip: Skip;
const _accessResult = access(name);
const _skipResult = skip(name);
const gate = createMaintenanceGate();
const lock = createPostgresAdvisoryLock({});
const handlers = { createNote: () => 1, listNotes: () => Promise.resolve('notes'), metadata: 7 };
const _defaultGate = wrapHandlersWithMaintenanceGate(handlers, gate);
const _defaultLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock);
const _undefinedGate = wrapHandlersWithMaintenanceGate(handlers, gate, undefined);
const _undefinedLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock, undefined);
const _emptyGate = wrapHandlersWithMaintenanceGate(handlers, gate, {});
const _emptyLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock, {});
const _explicitUndefinedGate = wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: undefined });
const _explicitUndefinedLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock, {
  getAccess: undefined,
  skip: undefined
});
const _opaqueGate = wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: () => unknownValue });
const _opaqueLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock, {
  getAccess: () => unknownValue,
  skip: () => unknownValue
});
const _literalGate = wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: () => 'read' });
const _helperGate = wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: getKnowledgeOperationAccess });
const _helperLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { getAccess: getKnowledgeOperationAccess });
const _wideGate = wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: (_name: unknown) => unknownValue });
const _wideLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { skip: (_name: unknown) => unknownValue });
const _pgSyncPattern = wrapHandlersWithMaintenanceGate(handlers, gate, {
  getAccess: name => (['push', 'pushBatch', 'uploadBlob', 'bootstrap'].includes(name) ? 'mutation' : 'read')
});
const _aiAttachmentPattern = wrapHandlersWithMaintenanceGate(handlers, gate, {
  getAccess: name => (['upload', 'remove'].includes(name) ? 'mutation' : 'read')
});
const _contextualLock = wrapHandlersWithPostgresAdvisoryLock(handlers, lock, {
  getAccess: name => {
    const _string: string = name;
    // @ts-expect-error callback keys are actual strings, not numbers
    const _number: number = name;
    void [_string, _number];
    return unknownValue;
  },
  skip: name => {
    const _string: string = name;
    // @ts-expect-error skip keys are actual strings, not numbers
    const _number: number = name;
    void [_string, _number];
    return unknownValue;
  }
});
const _contextualGate = wrapHandlersWithMaintenanceGate(handlers, gate, {
  getAccess: name => {
    const _string: string = name;
    // @ts-expect-error a broad key is not a known operation literal
    const _literal: 'createNote' = name;
    void [_string, _literal];
    return { then: () => undefined };
  }
});
const returns = [undefined, null, false, 0, 1n, Symbol('opaque'), 'other', {}, [], Promise.resolve('mutation')];
for (const result of returns) {
  wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: () => result });
  wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { getAccess: () => result, skip: () => result });
}
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: () => {} });
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { skip: () => {} });
wrapHandlersWithMaintenanceGate(handlers, gate, {
  getAccess: () => {
    throw unknownValue;
  }
});

// 实际消费者仍是 JS。连接可编译不等于参数、返回或事务端口已完整静态安全。
type LocalContext = ReturnType<typeof createAppContext>;
type PostgresContext = Awaited<ReturnType<typeof createPostgresAppContext>>;
type AiRuntime = ReturnType<typeof createAiRuntime>;
export type AccessCallbackContractChecks = [
  Assert<Equal<Parameters<Access>, [name: string]>>,
  Assert<Equal<Parameters<LockAccess>, [name: string]>>,
  Assert<Equal<Parameters<Skip>, [name: string]>>,
  Assert<Equal<ReturnType<Access>, unknown>>,
  Assert<Equal<ReturnType<LockAccess>, unknown>>,
  Assert<Equal<ReturnType<Skip>, unknown>>,
  Assert<Equal<typeof _accessResult, unknown>>,
  Assert<Equal<typeof _skipResult, unknown>>,
  Assert<Equal<GateOptions, { getAccess?: ((name: string) => unknown) | undefined }>>,
  Assert<
    Equal<
      LockOptions,
      { getAccess?: ((name: string) => unknown) | undefined; skip?: ((name: string) => unknown) | undefined }
    >
  >,
  Assert<Equal<IsAny<Access>, false>>,
  Assert<Equal<IsAny<ReturnType<Access>>, false>>,
  Assert<Equal<IsAny<Skip>, false>>,
  Assert<Equal<IsAny<ReturnType<Skip>>, false>>,
  Assert<Equal<Parameters<typeof wrapHandlersWithMaintenanceGate>['length'], 2 | 3>>,
  Assert<Equal<Parameters<typeof wrapHandlersWithPostgresAdvisoryLock>['length'], 2 | 3>>,
  Assert<Equal<Parameters<typeof wrapHandlersWithMaintenanceGate>[0], object>>,
  Assert<Equal<Parameters<typeof wrapHandlersWithMaintenanceGate>[1], ReturnType<typeof createMaintenanceGate>>>,
  Assert<Equal<IsAny<Parameters<typeof wrapHandlersWithPostgresAdvisoryLock>[0]>, true>>,
  Assert<Equal<IsAny<Parameters<typeof wrapHandlersWithPostgresAdvisoryLock>[1]>, true>>,
  Assert<Equal<(typeof _defaultGate)['createNote'], () => Promise<number>>>,
  Assert<Equal<IsAny<(typeof _defaultLock)['createNote']>, true>>,
  Assert<Equal<(typeof _opaqueGate)['createNote'], () => Promise<number>>>,
  Assert<Equal<IsAny<(typeof _opaqueLock)['createNote']>, true>>,
  Assert<Equal<IsAny<LocalContext['dataStore']>, true>>,
  Assert<Equal<IsAny<PostgresContext['http']['knowledge'][string]>, true>>,
  Assert<
    Equal<
      NonNullable<AiRuntime['actions']>['resumeForTurn'],
      ReturnType<typeof import('../src/modules/ai/action-service.js').createNoteActionService>['resumeForTurn']
    >
  >,
  Assert<Equal<Parameters<typeof getKnowledgeOperationAccess>, [name: unknown]>>,
  Assert<Equal<ReturnType<typeof getKnowledgeOperationAccess>, 'mutation' | 'read'>>
];

// @ts-expect-error unknown result is not validated access metadata
const _narrowResult: 'mutation' | 'read' = _accessResult;
// @ts-expect-error unknown skip output is not a boolean contract
const _booleanSkip: boolean = _skipResult;
// @ts-expect-error unknown result is not a string
const _stringResult: string = _accessResult;
// @ts-expect-error unknown result is not a promise contract
const _promiseResult: Promise<unknown> = _accessResult;
// @ts-expect-error arbitrary input is not an Object.entries key
access(unknownValue);
// @ts-expect-error an absent key is not passed by the wrapper
access(optionalName);
// @ts-expect-error key argument is required
access();
// @ts-expect-error callback has exactly one argument
access('read', 1);
// @ts-expect-error numeric callbacks cannot consume all string keys
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: (_name: number) => 'read' });
// @ts-expect-error narrow literal callbacks cannot consume all string keys
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: (_name: 'createNote') => 'mutation' });
// @ts-expect-error wrapper never supplies a required second argument
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: (_name: string, _extra: string) => 'read' });
// @ts-expect-error unknown is not a callable callback
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: unknownValue });
// @ts-expect-error null does not request the undefined default
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: null });
// @ts-expect-error null options still fail original destructuring
wrapHandlersWithMaintenanceGate(handlers, gate, null);
// @ts-expect-error callback shape is not a string
wrapHandlersWithMaintenanceGate(handlers, gate, { getAccess: 'read' });
// @ts-expect-error options reject misspelled callback field
wrapHandlersWithMaintenanceGate(handlers, gate, { getAcess: () => 'read' });
// @ts-expect-error PG callback key cannot be numeric
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { getAccess: (_name: number) => 'read' });
// @ts-expect-error PG callback cannot accept only a known literal
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { getAccess: (_name: 'createNote') => 'mutation' });
// @ts-expect-error PG skip callback cannot accept only a known literal
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { skip: (_name: 'createNote') => false });
// @ts-expect-error PG skip callback key cannot be numeric
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { skip: (_name: number) => false });
// @ts-expect-error PG skip wrapper does not pass a required second argument
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { skip: (_name: string, _extra: string) => false });
// @ts-expect-error PG skip callback is not nullable
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { skip: null });
// @ts-expect-error PG callback is not nullable
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { getAccess: null });
// @ts-expect-error null options still fail original destructuring
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, null);
// @ts-expect-error PG skip property must be callable
wrapHandlersWithPostgresAdvisoryLock(handlers, lock, { skip: true });
// @ts-expect-error skip output cannot be narrowed on a return guarantee
const _literalSkip: (name: string) => false = skip;
// @ts-expect-error access output cannot be narrowed on a return guarantee
const _literalAccess: (name: string) => 'read' = access;
void [
  _undefinedGate,
  _undefinedLock,
  _emptyGate,
  _emptyLock,
  _explicitUndefinedGate,
  _explicitUndefinedLock,
  _literalGate,
  _helperGate,
  _helperLock,
  _wideGate,
  _wideLock,
  _pgSyncPattern,
  _aiAttachmentPattern,
  _contextualLock,
  _contextualGate,
  _narrowResult,
  _booleanSkip,
  _stringResult,
  _promiseResult,
  _literalSkip,
  _literalAccess
];
