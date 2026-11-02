import {
  KnowledgeEvidence,
  type KnowledgeEvidenceConstructorInput
} from '../src/modules/knowledge/domain/knowledge-evidence.ts';
import { KnowledgeEvidence as ModelBridge } from '../src/modules/knowledge/domain/knowledge-evidence.js';
import {
  createInMemoryKnowledgeEvidenceRepository as repository,
  type KnowledgeEvidenceRecord,
  type KnowledgeEvidenceRepository,
  type KnowledgeEvidenceRepositoryOptions,
  type KnowledgeEvidenceListOptions,
  type StoredKnowledgeEvidenceRecord
} from '../src/modules/knowledge/infrastructure/knowledge-evidence-repository.ts';
import { createInMemoryKnowledgeEvidenceRepository as repositoryBridge } from '../src/modules/knowledge/infrastructure/knowledge-evidence-repository.js';
import { createInMemoryKnowledgeItemRepository } from '../src/modules/knowledge/infrastructure/knowledge-item-repository.ts';
import { createPostgresKnowledgeEvidenceRepository } from '../src/modules/knowledge/infrastructure/postgres/knowledge-evidence-repository.js';
import { createPostgresKnowledgeItemRepository } from '../src/modules/knowledge/infrastructure/postgres/knowledge-item-repository.js';
import { createKnowledgeItemService } from '../src/modules/knowledge/application/knowledge-item-service.js';
import { createAsyncKnowledgeItemService } from '../src/modules/knowledge/application/postgres-async/knowledge-domain-service.js';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import {
  toKnowledgeItemWorkspaceDto,
  type WorkspaceEvidenceRecord
} from '../src/modules/knowledge/application/workspace-query-dto.ts';
import { isEvidenceUsable } from '../src/modules/knowledge/domain/evidence-applicability.ts';

type Assert<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type SourceType = 'noteVersion' | 'annotation' | 'manual';
type Status = 'valid' | 'stale' | 'invalid' | 'insufficient';
type Applicability = 'active' | 'withdrawn' | 'needsReview';
interface OriginalInput {
  id: string;
  knowledgeItemId: string;
  sourceType?: string;
  sourceId?: string | null;
  noteId?: string | null;
  noteVersionId?: string | null;
  annotationId?: string | null;
  quoteText?: unknown;
  headingPath?: unknown[];
  relationType?: string;
  status?: string;
  applicabilityStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}
interface OriginalModel {
  id: string;
  knowledgeItemId: string;
  sourceType: SourceType;
  sourceId: string | null;
  noteId: string | null;
  noteVersionId: string | null;
  annotationId: string | null;
  quoteText: string;
  headingPath: string[];
  relationType: 'supports';
  status: Status;
  applicabilityStatus: Applicability;
  createdAt: string;
  updatedAt: string;
}
interface OriginalRecord {
  id: string;
  knowledgeItemId: string;
  sourceType?: SourceType | null;
  status?: Status | null;
  relationType?: 'supports' | null;
  applicabilityStatus?: Applicability | null;
  noteId?: string | null;
  noteVersionId?: string | null;
  annotationId?: string | null;
  sourceId?: unknown;
  quoteText?: unknown;
  headingPath?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}
interface OriginalRepository {
  create(evidence: OriginalRecord): OriginalRecord;
  save(evidence: OriginalRecord): OriginalRecord;
  findById(id: string | null | undefined): OriginalRecord | null;
  deleteByKnowledgeItemId(knowledgeItemId: string | null | undefined): OriginalRecord[];
  list(options?: KnowledgeEvidenceListOptions): OriginalRecord[];
  markByNoteId(noteId: string | null | undefined, status: Status): OriginalRecord[];
  markByAnnotationId(annotationId: string | null | undefined, status: Status): OriginalRecord[];
  markByNoteVersionId(
    noteVersionId: string | null | undefined,
    status: Status,
    sourceType?: SourceType | '' | null
  ): OriginalRecord[];
  markByNoteVersionIds(
    noteVersionIds: readonly string[],
    status: Status,
    sourceType?: SourceType | '' | null
  ): OriginalRecord[];
}
interface OriginalOptions {
  records?: OriginalRecord[] | null;
  onChange?: ((records: OriginalRecord[]) => void) | null;
}
interface UnknownBoundary {
  id: string;
  knowledgeItemId: string;
  sourceType: unknown;
  relationType: unknown;
  headingPath: unknown;
  quoteText: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}
type WideRecord = KnowledgeEvidenceRecord<unknown, unknown>;
declare const raw: unknown;
declare const originalInput: OriginalInput;
declare const boundary: UnknownBoundary;
const _default = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k' });
const _normal = new KnowledgeEvidence({
  id: 'e',
  knowledgeItemId: 'k',
  sourceType: 'manual',
  relationType: 'supports',
  headingPath: ['heading'],
  quoteText: 1n,
  createdAt: 'stamp'
});
const _fromOriginal = new KnowledgeEvidence(originalInput);
const _oldAssigned: KnowledgeEvidence = _normal;
const _oldInput: KnowledgeEvidenceConstructorInput = originalInput;
const _originalAssigned: KnowledgeEvidence = _fromOriginal;
const _created = new KnowledgeEvidence(boundary);
const _unknown = new KnowledgeEvidence({
  id: 'e',
  knowledgeItemId: 'k',
  sourceType: raw,
  relationType: raw,
  headingPath: raw,
  quoteText: raw,
  createdAt: raw,
  updatedAt: raw
});
const _explicitUnknown = new KnowledgeEvidence<unknown, unknown, unknown, unknown, unknown>({
  id: 'e',
  knowledgeItemId: 'k'
});
const _undefined = new KnowledgeEvidence<undefined, undefined, undefined, undefined, undefined>({
  id: 'e',
  knowledgeItemId: 'k'
});
const _never = new KnowledgeEvidence<never, never, never, never, never>({ id: 'e', knowledgeItemId: 'k' });
const _null = new KnowledgeEvidence({
  id: 'e',
  knowledgeItemId: 'k',
  sourceType: null,
  relationType: null,
  headingPath: null,
  createdAt: null,
  updatedAt: null
});
const _mixed = new KnowledgeEvidence<
  string | number,
  string | bigint,
  unknown[] | number,
  string | object,
  string | symbol
>({ id: 'e', knowledgeItemId: 'k' });
const _object = new KnowledgeEvidence({
  id: 'e',
  knowledgeItemId: 'k',
  sourceType: { source: true },
  relationType: { relation: true },
  createdAt: { date: 1 },
  updatedAt: 1n
});
const _linked = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', createdAt: { date: 1 } });
const _ordinaryUnknownArray = new KnowledgeEvidence({
  id: 'e',
  knowledgeItemId: 'k',
  headingPath: [raw, 1, null, Symbol()]
});
const _customMap = new KnowledgeEvidence({
  id: 'e',
  knowledgeItemId: 'k',
  headingPath: { map: (_callback: (item: unknown) => string) => ({ filter: (_predicate: typeof Boolean) => raw }) }
});
// 真实数组也可带实例级 map/filter 覆盖，不能仅以 Array.isArray 推导 string[]。
const _localMap = Object.assign(['heading'], {
  map: (_callback: (item: unknown) => string) => ({ filter: (_predicate: typeof Boolean) => 42 })
});
const _localFilter = Object.assign(['heading'], {
  map: (_callback: (item: unknown) => string) =>
    Object.assign(['mapped'], { filter: (_predicate: typeof Boolean) => 42 })
});
const _localNumericMap = Object.assign(['heading'], { map: (_callback: (item: unknown) => string) => [1, 2] });
const _localUnknownMap = Object.assign(['heading'], {
  map: (_callback: (item: unknown) => string) => ({ filter: (_predicate: typeof Boolean) => raw })
});
const _localMapModel = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: _localMap });
const _localFilterModel = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: _localFilter });
const _localNumericModel = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: _localNumericMap });
const _localUnknownModel = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: _localUnknownMap });
const _localMapRepo = repository({ records: [_localMapModel] });
const _localMapSaved = _localMapRepo.save(_localMapModel);
const _localMapFound = _localMapRepo.findById('e');
const _constHead = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: ['heading'] as const });
const _emptyConstHead = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: [] as const });
const _numberHead = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: [1, 2] });
const _constHeadAssigned: KnowledgeEvidence = _constHead;
const _emptyConstHeadAssigned: KnowledgeEvidence = _emptyConstHead;
const _numberHeadAssigned: KnowledgeEvidence = _numberHead;
declare class SpecializedMapArray extends Array<string> {
  map<Value>(callback: (value: string, index: number, array: string[]) => Value, thisArg?: unknown): Value[];
  map(callback: (value: unknown) => string): { filter: (predicate: typeof Boolean) => unknown };
}
declare class SpecializedFilterArray extends Array<string> {
  filter<Value extends string>(
    predicate: (value: string, index: number, array: string[]) => value is Value,
    thisArg?: unknown
  ): Value[];
  filter(predicate: (value: string, index: number, array: string[]) => unknown, thisArg?: unknown): string[];
  filter(predicate: typeof Boolean): number;
}
declare const _subclassMap: SpecializedMapArray;
declare const _subclassFilter: SpecializedFilterArray;
const _subclassMapModel = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: _subclassMap });
const _subclassFilterModel = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: _subclassFilter });
declare const _nativeUnionHead: string[] | number[];
declare const _nativeUnionExtraHead: (string[] & { marker?: 1 }) | (number[] & { other?: 2 });
declare const _unsafeUnionHead: typeof _localMap | string[];
const _nativeUnionModel = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: _nativeUnionHead });
const _nativeUnionExtraModel = new KnowledgeEvidence({
  id: 'e',
  knowledgeItemId: 'k',
  headingPath: _nativeUnionExtraHead
});
const _unsafeUnionModel = new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: _unsafeUnionHead });
const _nativeUnionAssigned: KnowledgeEvidence = _nativeUnionModel;
const _nativeUnionExtraAssigned: KnowledgeEvidence = _nativeUnionExtraModel;
function genericHeading<Heading extends unknown[]>(headingPath: Heading) {
  return new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath });
}
const _genericCustomHeading = genericHeading(_localMap);
const _genericUnionHeading = genericHeading(_unsafeUnionHead);
const _genericNormalHeading = genericHeading(['heading']);
const _genericNormalAssigned: KnowledgeEvidence = _genericNormalHeading;
// 显式旧数组注解会擦除实例自定义方法信息，只恢复旧调用域，不构成未知路径保证。
function oldArrayView<Heading extends unknown[]>(headingPath: Heading): KnowledgeEvidence {
  const ordinary: unknown[] = headingPath;
  return new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k', headingPath: ordinary });
}
const _oldArrayViewNormal = oldArrayView(['heading']);
const _oldArrayViewErased = oldArrayView(_localMap);

const _empty = repository();
const _literal = repository({ records: [] });
const _literalCreated = _literal.create({ id: 'e', knowledgeItemId: 'k' });
const _literalSaved = _literal.save({ id: 'e', knowledgeItemId: 'k', sourceType: 'manual', relationType: 'supports' });
const _options = { records: [] };
const _optionsFactory = repository(_options);
const _typedNeverRecords: never[] = [];
const _typedNever = repository({ records: _typedNeverRecords });
const _explicitNever = repository<never>({ records: [] });
const _freshTuple = repository({ records: [] as const });
const _mutableTupleRecords: [] = [];
const _mutableTuple = repository({ records: _mutableTupleRecords });
const _nullRecords = repository({ records: null });
const _undefinedRecords = repository({ records: undefined });
const _contextual = repository({
  records: [],
  onChange: rows => rows.push({ id: 'hook', knowledgeItemId: 'k', sourceType: 'manual' })
});
const _annotatedOptions: KnowledgeEvidenceRepositoryOptions = { records: [] };
const _fromAnnotatedOptions = repository(_annotatedOptions);
for (const factory of [
  _optionsFactory,
  _typedNever,
  _explicitNever,
  _freshTuple,
  _mutableTuple,
  _nullRecords,
  _undefinedRecords,
  _contextual,
  _fromAnnotatedOptions
])
  factory.save({ id: 'e', knowledgeItemId: 'k', sourceType: 'manual' });
const _oldRecords: KnowledgeEvidenceRecord[] = [{ id: 'e', knowledgeItemId: 'k' }];
const _fromOldRecords = repository({ records: _oldRecords });
_fromOldRecords.save({ id: 'e2', knowledgeItemId: 'k', sourceType: 'annotation' });
const _explicitOld = repository<KnowledgeEvidenceRecord>({ records: [{ id: 'e', knowledgeItemId: 'k' }] });
_explicitOld.save({ id: 'e2', knowledgeItemId: 'k', sourceType: 'noteVersion' });
const _minimal = repository({ records: [{ id: 'e', knowledgeItemId: 'k' }] });
const _oldRecord: KnowledgeEvidenceRecord = { id: 'e', knowledgeItemId: 'k', sourceType: 'manual' };
_minimal.save(_oldRecord);
const _wideRecords: WideRecord[] = [];
const _wideFromRecords = repository({ records: _wideRecords });
const _wide = repository<WideRecord>();
const _wideOptions: KnowledgeEvidenceRepositoryOptions<WideRecord> = {
  records: [_created],
  onChange: rows => {
    const _value: unknown = rows[0]?.sourceType;
    void _value;
  }
};
const _wideFromOptions = repository(_wideOptions);
const _saved = _wide.save(_created);
const _createdRecord = _wide.create(_created);
const _found = _wide.findById('e');
const _list = _wide.list({ knowledgeItemId: 'k' });
const _deleted = _wide.deleteByKnowledgeItemId('k');
const _markedNote = _wide.markByNoteId('n', 'stale');
const _markedAnnotation = _wide.markByAnnotationId('a', 'invalid');
const _markedVersion = _wide.markByNoteVersionId('v', 'valid', 'annotation');
const _markedVersions = _wide.markByNoteVersionIds(['v'], 'insufficient', 'noteVersion');
const _inferred = repository({ records: [_created] });
const _inferredSaved = _inferred.save(_created);
const _inferredFound = _inferred.findById('e');
const _inferredMarked = _inferred.markByNoteId('n', 'invalid');
const _taggedModel = { ..._created, marker: 1 };
const _tagged = repository({ records: [_taggedModel] });
const _taggedFound = _tagged.findById('e');
const _taggedSaved = _tagged.save({ ..._created, marker: 2 });
const _rebuiltTagged = new KnowledgeEvidence(_taggedModel);
const _narrowMutable = {
  id: 'e',
  knowledgeItemId: 'k',
  status: 'valid' as const,
  updatedAt: 1,
  createdAt: 2,
  marker: 'tag'
};
const _mutated = repository({
  records: [_narrowMutable],
  onChange: rows => {
    const _status: Status | null | undefined = rows[0]?.status;
    const _time: number | string | undefined = rows[0]?.updatedAt;
    const _marker: string = rows[0].marker;
    void [_status, _time, _marker];
  }
});
const _mutatedSaved = _mutated.save(_narrowMutable);
const _mutatedFound = _mutated.findById('e');
const _mutatedList = _mutated.list();
const _mutatedDeleted = _mutated.deleteByKnowledgeItemId('k');
const _mutatedMarked = _mutated.markByNoteId('n', 'stale');
if (_mutatedFound) _mutated.save(_mutatedFound);
_mutated.save({
  id: 'roundtrip',
  knowledgeItemId: 'k',
  createdAt: 2,
  marker: 'tag',
  status: 'invalid',
  updatedAt: 'later'
});
const _readonly = { id: 'e', knowledgeItemId: 'k', status: 'valid', updatedAt: 1, marker: 'r' } as const;
const _readonlyFactory = repository({ records: [_readonly] });
const _readonlySaved = _readonlyFactory.save(_readonly);
type UnionRecord = WideRecord & ({ kind: 'a'; a: number } | { kind: 'b'; b: string });
declare const _unionRecords: UnionRecord[];
const _union = repository({ records: _unionRecords });
const _unionFound = _union.findById('e');
if (_unionFound?.kind === 'a') {
  const _a: number = _unionFound.a;
  void _a;
}
if (_unionFound?.kind === 'b') {
  const _b: string = _unionFound.b;
  void _b;
}
function genericRecords<Record extends WideRecord>(records: Record[]) {
  const result = repository<Record>({ records });
  result.save(records[0]);
  return result;
}
const _generic = genericRecords([_taggedModel]);
const _genericFound = _generic.findById('e');
const _neverFields = repository<KnowledgeEvidenceRecord<never, never>>();
const _projection = toKnowledgeItemWorkspaceDto({ id: 'k' }, { evidence: _list });
const _projectionInput: WorkspaceEvidenceRecord = _saved;
isEvidenceUsable(_saved);
// 实际 JS 端口接线只验证可接入，不能把 any 当成端到端安全保证。
declare const pg: ReturnType<typeof createPostgresKnowledgeEvidenceRepository>;
declare const pgItems: ReturnType<typeof createPostgresKnowledgeItemRepository>;
pg.create(_created);
pg.save(_created);
const _transaction = <Value>(operation: () => Value): Value => operation();
const _localPorts = {
  repository:
    createInMemoryKnowledgeItemRepository<import('../src/modules/knowledge/domain/knowledge-item.ts').KnowledgeItem>(),
  evidenceRepository: repository<KnowledgeEvidence>(),
  runTransaction: _transaction
};
const _sync = createKnowledgeItemService(_localPorts);
const _postgresPorts = { ..._localPorts, repository: pgItems, evidenceRepository: pg };
const _async = createAsyncKnowledgeItemService(_postgresPorts);
const _mixedService = createAsyncKnowledgeItemService(_localPorts);
const _syncCreated = _sync.createEvidence(boundary);
const _asyncCreated = _async.createEvidence(boundary);
_mixedService.createEvidence(boundary);
const _installed = createKnowledgeModule().repositories.knowledgeEvidenceRepository;
const _installedRecords = _installed.list();
const _installedRebuilt = repository({ records: _installedRecords });
const _installedHook = repository({ records: _installedRecords, onChange: _installed.onChange });
declare const _wideConstructor: ConstructorParameters<typeof KnowledgeEvidence>[0];
declare const _wideInstance: InstanceType<typeof KnowledgeEvidence>;
const _legacyFactory: (options?: OriginalOptions) => OriginalRepository = repository;
const _legacyConstructor: new (input: OriginalInput) => OriginalModel = KnowledgeEvidence;
const _oldRepository: OriginalRepository = _empty;
const _restoredRepository: KnowledgeEvidenceRepository = _oldRepository;
void [_legacyFactory, _legacyConstructor, _restoredRepository, _projectionInput];

export type EvidenceBoundaryContracts = [
  Assert<Equal<KnowledgeEvidenceConstructorInput, OriginalInput>>,
  Assert<Equal<KnowledgeEvidence, OriginalModel>>,
  Assert<Equal<KnowledgeEvidenceRecord, OriginalRecord>>,
  Assert<Equal<StoredKnowledgeEvidenceRecord<KnowledgeEvidenceRecord>, OriginalRecord>>,
  Assert<Equal<KnowledgeEvidenceRepository, OriginalRepository>>,
  Assert<Equal<KnowledgeEvidenceRepositoryOptions, OriginalOptions>>,
  Assert<Equal<typeof _default, KnowledgeEvidence>>,
  Assert<Equal<typeof _oldAssigned, KnowledgeEvidence>>,
  Assert<Equal<typeof _oldInput, OriginalInput>>,
  Assert<Equal<typeof _originalAssigned, KnowledgeEvidence>>,
  Assert<Equal<typeof _normal.sourceType, SourceType>>,
  Assert<Equal<typeof _normal.relationType, 'supports'>>,
  Assert<Equal<typeof _normal.headingPath, string[]>>,
  Assert<Equal<typeof _normal.quoteText, string>>,
  Assert<Equal<typeof _normal.createdAt, string>>,
  Assert<Equal<typeof _normal.updatedAt, string>>,
  Assert<Equal<typeof _created.sourceType, unknown>>,
  Assert<Equal<typeof _created.relationType, unknown>>,
  Assert<Equal<typeof _created.headingPath, unknown>>,
  Assert<Equal<typeof _created.quoteText, string>>,
  Assert<Equal<typeof _created.createdAt, unknown>>,
  Assert<Equal<typeof _created.updatedAt, unknown>>,
  Assert<Equal<typeof _unknown, typeof _explicitUnknown>>,
  Assert<Equal<typeof _undefined.sourceType, SourceType>>,
  Assert<Equal<typeof _undefined.relationType, 'supports'>>,
  Assert<Equal<typeof _undefined.headingPath, string[]>>,
  Assert<Equal<typeof _undefined.createdAt, string>>,
  Assert<Equal<typeof _never.sourceType, SourceType>>,
  Assert<Equal<typeof _never.relationType, 'supports'>>,
  Assert<Equal<typeof _never.headingPath, string[]>>,
  Assert<Equal<typeof _never.updatedAt, string>>,
  Assert<Equal<typeof _null.sourceType, SourceType | null>>,
  Assert<Equal<typeof _null.relationType, 'supports' | null>>,
  Assert<Equal<typeof _null.headingPath, unknown>>,
  Assert<Equal<typeof _null.createdAt, string | null>>,
  Assert<Equal<typeof _null.updatedAt, string | null>>,
  Assert<Equal<typeof _mixed.sourceType, SourceType | number>>,
  Assert<Equal<typeof _mixed.relationType, 'supports' | bigint>>,
  Assert<Equal<typeof _mixed.headingPath, unknown>>,
  Assert<Equal<typeof _mixed.createdAt, string | object>>,
  Assert<Equal<typeof _mixed.updatedAt, string | object | symbol>>,
  Assert<Equal<typeof _object.sourceType, SourceType | { source: boolean }>>,
  Assert<Equal<typeof _object.relationType, 'supports' | { relation: boolean }>>,
  Assert<Equal<typeof _object.createdAt, string | { date: number }>>,
  Assert<Equal<typeof _object.updatedAt, string | { date: number } | bigint>>,
  Assert<Equal<typeof _linked.updatedAt, string | { date: number }>>,
  Assert<Equal<typeof _ordinaryUnknownArray.headingPath, string[]>>,
  Assert<Equal<typeof _customMap.headingPath, unknown>>,
  Assert<Equal<typeof _localMapModel.headingPath, unknown>>,
  Assert<Equal<typeof _localFilterModel.headingPath, unknown>>,
  Assert<Equal<typeof _localNumericModel.headingPath, unknown>>,
  Assert<Equal<typeof _localUnknownModel.headingPath, unknown>>,
  Assert<Equal<typeof _subclassMapModel.headingPath, unknown>>,
  Assert<Equal<typeof _subclassFilterModel.headingPath, unknown>>,
  Assert<Equal<typeof _localMapSaved.headingPath, unknown>>,
  Assert<Equal<NonNullable<typeof _localMapFound>['headingPath'], unknown>>,
  Assert<Equal<typeof _constHead.headingPath, string[]>>,
  Assert<Equal<typeof _emptyConstHead.headingPath, string[]>>,
  Assert<Equal<typeof _numberHead.headingPath, string[]>>,
  Assert<Equal<typeof _constHeadAssigned, KnowledgeEvidence>>,
  Assert<Equal<typeof _emptyConstHeadAssigned, KnowledgeEvidence>>,
  Assert<Equal<typeof _numberHeadAssigned, KnowledgeEvidence>>,
  Assert<Equal<typeof _nativeUnionModel.headingPath, string[]>>,
  Assert<Equal<typeof _nativeUnionExtraModel.headingPath, string[]>>,
  Assert<Equal<typeof _nativeUnionAssigned, KnowledgeEvidence>>,
  Assert<Equal<typeof _nativeUnionExtraAssigned, KnowledgeEvidence>>,
  Assert<Equal<typeof _unsafeUnionModel.headingPath, unknown>>,
  Assert<Equal<typeof _genericCustomHeading.headingPath, unknown>>,
  Assert<Equal<typeof _genericUnionHeading.headingPath, unknown>>,
  Assert<Equal<typeof _genericNormalHeading.headingPath, string[]>>,
  Assert<Equal<typeof _genericNormalAssigned, KnowledgeEvidence>>,
  Assert<Equal<typeof _oldArrayViewNormal.headingPath, string[]>>,
  Assert<Equal<typeof _oldArrayViewErased.headingPath, string[]>>,
  Assert<Equal<typeof _empty, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _literal, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _literalCreated, KnowledgeEvidenceRecord>>,
  Assert<Equal<typeof _literalSaved, KnowledgeEvidenceRecord>>,
  Assert<Equal<typeof _optionsFactory, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _typedNever, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _explicitNever, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _freshTuple, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _mutableTuple, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _nullRecords, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _undefinedRecords, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _contextual, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _fromAnnotatedOptions, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _fromOldRecords, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _explicitOld, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _minimal, KnowledgeEvidenceRepository<{ id: string; knowledgeItemId: string }>>>,
  Assert<Equal<typeof _wideFromRecords, KnowledgeEvidenceRepository<WideRecord>>>,
  Assert<Equal<typeof _wideFromOptions, KnowledgeEvidenceRepository<WideRecord>>>,
  Assert<Equal<typeof _saved, WideRecord>>,
  Assert<Equal<typeof _createdRecord, WideRecord>>,
  Assert<Equal<typeof _found, WideRecord | null>>,
  Assert<Equal<typeof _list, WideRecord[]>>,
  Assert<Equal<typeof _deleted, WideRecord[]>>,
  Assert<Equal<typeof _markedNote, WideRecord[]>>,
  Assert<Equal<typeof _markedAnnotation, WideRecord[]>>,
  Assert<Equal<typeof _markedVersion, WideRecord[]>>,
  Assert<Equal<typeof _markedVersions, WideRecord[]>>,
  Assert<Equal<typeof _inferredSaved.sourceType, unknown>>,
  Assert<Equal<typeof _inferredSaved.relationType, unknown>>,
  Assert<Equal<typeof _inferredSaved.headingPath, unknown>>,
  Assert<Equal<typeof _inferredSaved.quoteText, string>>,
  Assert<Equal<typeof _inferredSaved.updatedAt, unknown>>,
  Assert<Equal<NonNullable<typeof _inferredFound>['sourceType'], unknown>>,
  Assert<Equal<(typeof _inferredMarked)[number]['headingPath'], unknown>>,
  Assert<Equal<NonNullable<typeof _taggedFound>['marker'], number>>,
  Assert<Equal<typeof _taggedSaved.marker, number>>,
  Assert<Equal<'marker' extends keyof typeof _rebuiltTagged ? true : false, false>>,
  Assert<Equal<typeof _mutatedSaved.status, Status | null | undefined>>,
  Assert<Equal<typeof _mutatedSaved.updatedAt, string | number | undefined>>,
  Assert<Equal<typeof _mutatedSaved.createdAt, number>>,
  Assert<Equal<NonNullable<typeof _mutatedFound>['status'], Status | null | undefined>>,
  Assert<Equal<(typeof _mutatedList)[number]['updatedAt'], string | number | undefined>>,
  Assert<Equal<(typeof _mutatedDeleted)[number]['status'], Status | null | undefined>>,
  Assert<Equal<(typeof _mutatedMarked)[number]['updatedAt'], string | number | undefined>>,
  Assert<Equal<typeof _readonlySaved.marker, 'r'>>,
  Assert<Equal<typeof _readonlySaved.status, Status | null | undefined>>,
  Assert<Equal<typeof _readonlySaved.updatedAt, string | 1 | undefined>>,
  Assert<Equal<NonNullable<typeof _genericFound>['marker'], number>>,
  Assert<Equal<typeof _neverFields, KnowledgeEvidenceRepository<KnowledgeEvidenceRecord<never, never>>>>,
  Assert<Equal<typeof _projection.evidenceSummary, unknown>>,
  Assert<Equal<typeof _projection.updatedAt, unknown>>,
  Assert<Equal<typeof ModelBridge, typeof KnowledgeEvidence>>,
  Assert<Equal<typeof repositoryBridge, typeof repository>>,
  Assert<Equal<Parameters<KnowledgeEvidenceRepository['save']>, [KnowledgeEvidenceRecord]>>,
  Assert<Equal<ReturnType<KnowledgeEvidenceRepository['save']>, KnowledgeEvidenceRecord>>,
  Assert<Equal<ReturnType<typeof repository>, KnowledgeEvidenceRepository<WideRecord>>>,
  Assert<Equal<Parameters<typeof repository>, [KnowledgeEvidenceRepositoryOptions<WideRecord>?]>>,
  Assert<Equal<typeof _wideConstructor.sourceType, unknown>>,
  Assert<Equal<typeof _wideConstructor.relationType, unknown>>,
  Assert<Equal<typeof _wideConstructor.headingPath, unknown>>,
  Assert<Equal<typeof _wideInstance.sourceType, unknown>>,
  Assert<Equal<typeof _wideInstance.relationType, unknown>>,
  Assert<Equal<typeof _wideInstance.headingPath, unknown>>,
  Assert<Equal<typeof _wideInstance.quoteText, string>>,
  Assert<Equal<typeof _wideInstance.createdAt, unknown>>,
  Assert<Equal<IsAny<typeof _saved.sourceType>, false>>,
  Assert<Equal<IsAny<typeof _saved.headingPath>, false>>,
  Assert<Equal<IsAny<typeof _projection.evidenceSummary>, false>>,
  Assert<Equal<IsAny<typeof _wideInstance>, false>>,
  Assert<Equal<IsAny<typeof _installed>, true>>,
  Assert<Equal<IsAny<typeof _installedRecords>, true>>,
  Assert<Equal<typeof _installedRebuilt, KnowledgeEvidenceRepository>>,
  Assert<Equal<typeof _installedHook, KnowledgeEvidenceRepository>>,
  Assert<
    Equal<
      'evidenceRepository' extends keyof NonNullable<Parameters<typeof createKnowledgeItemService>[0]> ? true : false,
      true
    >
  >,
  Assert<
    Equal<
      'evidenceRepository' extends keyof NonNullable<Parameters<typeof createAsyncKnowledgeItemService>[0]>
        ? true
        : false,
      true
    >
  >,
  Assert<Equal<IsAny<typeof _syncCreated>, true>>,
  Assert<Equal<IsAny<Awaited<typeof _asyncCreated>>, true>>,
  Assert<Equal<'expectedAnnotationRevision' extends keyof KnowledgeEvidence ? true : false, false>>,
  Assert<Equal<'revision' extends keyof KnowledgeEvidenceRecord ? true : false, false>>
];
