import { KnowledgeItem, type KnowledgeItemConstructorInput } from '../src/modules/knowledge/domain/knowledge-item.ts';
import { KnowledgeItem as ModelBridge } from '../src/modules/knowledge/domain/knowledge-item.js';
import {
  createInMemoryKnowledgeItemRepository as repository,
  type KnowledgeItemRecord,
  type KnowledgeItemRepository,
  type KnowledgeItemRepositoryOptions,
  type KnowledgeItemSaveOptions,
  type KnowledgeItemListOptions
} from '../src/modules/knowledge/infrastructure/knowledge-item-repository.ts';
import { createInMemoryKnowledgeItemRepository as repositoryBridge } from '../src/modules/knowledge/infrastructure/knowledge-item-repository.js';
import { createPostgresKnowledgeItemRepository } from '../src/modules/knowledge/infrastructure/postgres/knowledge-item-repository.js';
import { createKnowledgeItemService } from '../src/modules/knowledge/application/knowledge-item-service.js';
import { createAsyncKnowledgeItemService } from '../src/modules/knowledge/application/postgres-async/knowledge-domain-service.js';
import { createInMemoryKnowledgeEvidenceRepository } from '../src/modules/knowledge/infrastructure/knowledge-evidence-repository.js';
import { assertKnowledgeItemConfirmable } from '../src/modules/knowledge/application/formal-asset-validation.js';
import { toKnowledgeItemWorkspaceDto } from '../src/modules/knowledge/application/workspace-query-dto.ts';
import { nextKnowledgeItemTimestamp } from '../src/modules/knowledge/application/knowledge-item-concurrency.js';

type Assert<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type SourceMode = 'manual' | 'annotation' | 'selection' | 'ai';
type ReviewStatus = 'candidate' | 'confirmed' | 'needsRevision' | 'archived';
interface OriginalInput {
  id: string;
  title?: string;
  canonicalStatement?: string;
  userExplanation?: string | null;
  knowledgeType?: string;
  importance?: unknown;
  reviewStatus?: string;
  sourceMode?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}
interface OriginalModel {
  id: string;
  title: string;
  canonicalStatement: string;
  userExplanation: string;
  knowledgeType: string;
  importance: number | null;
  reviewStatus: ReviewStatus;
  sourceMode: SourceMode;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
interface OriginalRecord {
  id: string;
  title?: string;
  canonicalStatement?: string;
  reviewStatus?: ReviewStatus | null;
  sourceMode?: SourceMode | null;
  userExplanation?: unknown;
  knowledgeType?: unknown;
  importance?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
}
interface OriginalRepository {
  create(item: OriginalRecord): OriginalRecord;
  save(item: OriginalRecord, options?: KnowledgeItemSaveOptions): OriginalRecord;
  findById(id: string | null | undefined): OriginalRecord | null;
  delete(id: string | null | undefined): OriginalRecord | null;
  list(options?: KnowledgeItemListOptions): OriginalRecord[];
}
interface OriginalOptions {
  records?: OriginalRecord[] | null;
  onChange?: ((records: OriginalRecord[]) => void) | null;
}
// 表达后续 DTO 的真实未知边界，不依赖当前 JS DTO 推导出的 any。
interface UnknownCreateInput {
  id: string;
  title: string;
  canonicalStatement: string;
  userExplanation: string;
  knowledgeType: unknown;
  importance: number | null;
  sourceMode: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}
interface UnknownUpdateInput {
  title?: unknown;
  canonicalStatement?: unknown;
  userExplanation?: unknown;
  knowledgeType?: unknown;
  importance?: number | null;
  sourceMode?: unknown;
}
declare const raw: unknown;
declare const originalInput: OriginalInput;
declare const createInput: UnknownCreateInput;
declare const updateInput: UnknownUpdateInput;
const _default = new KnowledgeItem({ id: 'k' });
const _concept = new KnowledgeItem({ id: 'k', knowledgeType: 'concept' });
const _string = new KnowledgeItem({ id: 'k', knowledgeType: 'fact', sourceMode: 'manual', userExplanation: 'text' });
const _oldAssignment: KnowledgeItem = _string;
const _original = new KnowledgeItem(originalInput);
const _originalAssignment: KnowledgeItem = _original;
const _oldInput: KnowledgeItemConstructorInput = originalInput;
const _created = new KnowledgeItem(createInput);
const _updated = new KnowledgeItem({ ..._created, ...updateInput });
const _allUnknown = new KnowledgeItem({
  id: 'k',
  title: raw,
  canonicalStatement: raw,
  userExplanation: raw,
  knowledgeType: raw,
  sourceMode: raw,
  createdAt: raw,
  updatedAt: raw
});
const _explicitUnknown = new KnowledgeItem<unknown, unknown, unknown, unknown, unknown, unknown, unknown>({ id: 'k' });
const _mixed = new KnowledgeItem<string | number, string | symbol, string | object, string | number, string | bigint>({
  id: 'k'
});
const _null = new KnowledgeItem({
  id: 'k',
  userExplanation: null,
  knowledgeType: null,
  sourceMode: null,
  createdAt: null,
  updatedAt: null
});
const _object = new KnowledgeItem({
  id: 'k',
  userExplanation: { trim: () => true },
  knowledgeType: { historical: true },
  sourceMode: { kind: 1 },
  createdAt: { date: 1 },
  updatedAt: 1n
});
const _linked = new KnowledgeItem({ id: 'k', createdAt: { date: 1 } });
const _never = new KnowledgeItem<never, never, never, never, never, never, never>({ id: 'k' });
const _undefined = new KnowledgeItem<undefined, undefined, undefined, undefined, undefined, undefined, undefined>({
  id: 'k'
});
const _empty = repository();
const _emptyLiteral = repository({ records: [] });
const _emptyLiteralCreated = _emptyLiteral.create({ id: 'empty-create' });
const _emptyLiteralSaved = _emptyLiteral.save({ id: 'empty-save', sourceMode: 'manual' });
const _emptyLiteralFound = _emptyLiteral.findById('empty-save');
const _emptyLiteralList = _emptyLiteral.list();
const _emptyOptions = { records: [] };
const _emptyVariable = repository(_emptyOptions);
_emptyVariable.save({ id: 'empty-variable' });
const _emptyNull = repository({ records: null });
const _emptyUndefined = repository({ records: undefined });
const _emptyNeverRecords: never[] = [];
const _emptyNever = repository({ records: _emptyNeverRecords });
const _explicitNever = repository<never>({ records: [] });
const _emptyWideRecords: KnowledgeItemRecord<unknown>[] = [];
const _emptyTypedWide = repository({ records: _emptyWideRecords });
const _emptyExplicitWide = repository<KnowledgeItemRecord<unknown>>({ records: [] });
const _emptyWideCallback = repository({ records: [], onChange: (_rows: KnowledgeItemRecord<unknown>[]) => {} });
const _emptyContextCallback = repository({
  records: [],
  onChange: _rows => {
    _rows.push({ id: 'callback' });
  }
});
const _emptyFreshReadonly = repository({ records: [] as const });
const _emptyTuple: [] = [];
const _emptyMutableTuple = repository({ records: _emptyTuple });
const _narrowInferred = repository({ records: [{ id: 'k' }] });
const _legacyRecord: KnowledgeItemRecord = { id: 'legacy', sourceMode: 'manual' };
_narrowInferred.save(_legacyRecord);
const _declaredLegacyRecords: KnowledgeItemRecord[] = [{ id: 'k' }];
const _typedLegacy = repository({ records: _declaredLegacyRecords });
_typedLegacy.save({ id: 'next', sourceMode: 'manual' });
const _explicitLegacy = repository<KnowledgeItemRecord>({ records: [{ id: 'k' }] });
_explicitLegacy.save({ id: 'next', sourceMode: 'manual' });
const _neverMode = repository<KnowledgeItemRecord<never>>({ records: [] });
_emptyTypedWide.save(_updated);
_emptyExplicitWide.save(_updated);
_emptyWideCallback.save(_updated);
const _oldSaved = _empty.save(_string);
const _wide = repository<KnowledgeItemRecord<unknown>>();
const _saved = _wide.save(_created);
const _savedUpdate = _wide.save(_updated);
const _found = _wide.findById('k');
const _listed = _wide.list();
const _deleted = _wide.delete('k');
const _inferred = repository({ records: [_created] });
const _inferredSaved = _inferred.save(_created);
const _inferredFound = _inferred.findById('k');
const _inferredList = _inferred.list();
const _tagged = repository({ records: [{ ..._created, marker: 1 }] });
const _taggedFound = _tagged.findById('k');
const _rebuiltTagged = new KnowledgeItem({ ..._created, ...{ marker: 1 } });
const _taggedReplacement = _tagged.save({ ..._created, marker: 2 });
const _explicitOptions: KnowledgeItemRepositoryOptions<KnowledgeItemRecord<unknown>> = {
  records: [_updated],
  onChange: records => {
    const _value: unknown = records[0]?.sourceMode;
    void _value;
  }
};
const _fromOptions = repository(_explicitOptions);
const _reconstructed = new KnowledgeItem({ ..._saved, reviewStatus: 'candidate', deletedAt: null });
assertKnowledgeItemConfirmable(_updated);
nextKnowledgeItemTimestamp(_saved);
const _projection = toKnowledgeItemWorkspaceDto(_saved);
// PG 和服务仍为 JS；这里只验证实际工厂连接，不以 any 返回值代替上述宽链检查。
declare const pg: ReturnType<typeof createPostgresKnowledgeItemRepository>;
pg.create(_updated);
pg.save(new KnowledgeItem({ id: 'k', title: 'Known model' }));
const _transaction = <Value>(operation: () => Value): Value => operation();
const _ports = {
  repository: repository<KnowledgeItem>(),
  evidenceRepository:
    createInMemoryKnowledgeEvidenceRepository<
      import('../src/modules/knowledge/domain/knowledge-evidence.ts').KnowledgeEvidence
    >()
};
createKnowledgeItemService({ ..._ports, runTransaction: _transaction }).createCandidate(createInput);
createKnowledgeItemService({ ..._ports, runTransaction: _transaction }).updateItem('k', updateInput);
const _asyncPorts = { ..._ports, repository: pg };
createAsyncKnowledgeItemService({ ..._asyncPorts, runTransaction: _transaction }).createCandidate(createInput);
createAsyncKnowledgeItemService({ ..._ports, runTransaction: _transaction }).createCandidate(createInput);
declare const _wideConstructor: ConstructorParameters<typeof KnowledgeItem>[0];
declare const _wideInstance: InstanceType<typeof KnowledgeItem>;
const __wideConstructorInput: typeof _wideConstructor = originalInput;
const _originalRepository: OriginalRepository = _empty;
const _defaultRepository: KnowledgeItemRepository = _originalRepository;

export type KnowledgeItemBoundaryContracts = [
  Assert<Equal<KnowledgeItemConstructorInput, OriginalInput>>,
  Assert<Equal<KnowledgeItem, OriginalModel>>,
  Assert<Equal<KnowledgeItemRecord, OriginalRecord>>,
  Assert<Equal<KnowledgeItemRepository, OriginalRepository>>,
  Assert<Equal<KnowledgeItemRepositoryOptions, OriginalOptions>>,
  Assert<Equal<typeof _default, KnowledgeItem>>,
  Assert<Equal<typeof _originalAssignment, KnowledgeItem>>,
  Assert<Equal<typeof _oldInput, OriginalInput>>,
  Assert<Equal<typeof _oldAssignment, KnowledgeItem>>,
  Assert<Equal<typeof _string.sourceMode, SourceMode>>,
  Assert<Equal<typeof _concept.knowledgeType, 'concept'>>,
  Assert<Equal<typeof _created.title, string>>,
  Assert<Equal<typeof _created.canonicalStatement, string>>,
  Assert<Equal<typeof _created.userExplanation, string>>,
  Assert<Equal<typeof _created.knowledgeType, unknown>>,
  Assert<Equal<typeof _created.sourceMode, unknown>>,
  Assert<Equal<typeof _created.createdAt, unknown>>,
  Assert<Equal<typeof _created.updatedAt, unknown>>,
  Assert<Equal<typeof _updated.title, string>>,
  Assert<Equal<typeof _updated.canonicalStatement, string>>,
  Assert<Equal<typeof _updated.userExplanation, unknown>>,
  Assert<Equal<typeof _updated.knowledgeType, unknown>>,
  Assert<Equal<typeof _updated.sourceMode, unknown>>,
  Assert<Equal<typeof _allUnknown, typeof _explicitUnknown>>,
  Assert<Equal<typeof _allUnknown.userExplanation, unknown>>,
  Assert<Equal<typeof _mixed.title, string>>,
  Assert<Equal<typeof _mixed.userExplanation, unknown>>,
  Assert<Equal<typeof _mixed.knowledgeType, string | number>>,
  Assert<Equal<typeof _mixed.sourceMode, bigint | SourceMode>>,
  Assert<Equal<typeof _null.userExplanation, string>>,
  Assert<Equal<typeof _null.knowledgeType, null | 'concept'>>,
  Assert<Equal<typeof _null.sourceMode, null | SourceMode>>,
  Assert<Equal<typeof _null.createdAt, null | string>>,
  Assert<Equal<typeof _null.updatedAt, null | string>>,
  Assert<Equal<typeof _object.userExplanation, unknown>>,
  Assert<Equal<typeof _object.knowledgeType, { historical: boolean } | 'concept'>>,
  Assert<Equal<typeof _object.sourceMode, { kind: number } | SourceMode>>,
  Assert<Equal<typeof _object.createdAt, { date: number } | string>>,
  Assert<Equal<typeof _object.updatedAt, bigint | { date: number } | string>>,
  Assert<Equal<typeof _linked.updatedAt, { date: number } | string>>,
  Assert<Equal<typeof _never.title, string>>,
  Assert<Equal<typeof _never.userExplanation, string>>,
  Assert<Equal<typeof _never.knowledgeType, 'concept'>>,
  Assert<Equal<typeof _never.sourceMode, SourceMode>>,
  Assert<Equal<typeof _never.createdAt, string>>,
  Assert<Equal<typeof _undefined.knowledgeType, 'concept'>>,
  Assert<Equal<typeof _undefined.userExplanation, string>>,
  Assert<Equal<typeof _undefined.sourceMode, SourceMode>>,
  Assert<Equal<typeof _empty, KnowledgeItemRepository>>,
  Assert<Equal<typeof _emptyLiteral, KnowledgeItemRepository>>,
  Assert<Equal<typeof _emptyLiteralCreated, KnowledgeItemRecord>>,
  Assert<Equal<typeof _emptyLiteralSaved, KnowledgeItemRecord>>,
  Assert<Equal<typeof _emptyLiteralFound, KnowledgeItemRecord | null>>,
  Assert<Equal<typeof _emptyLiteralList, KnowledgeItemRecord[]>>,
  Assert<Equal<typeof _emptyVariable, KnowledgeItemRepository>>,
  Assert<Equal<typeof _emptyNull, KnowledgeItemRepository>>,
  Assert<Equal<typeof _emptyUndefined, KnowledgeItemRepository>>,
  Assert<Equal<typeof _emptyNever, KnowledgeItemRepository>>,
  Assert<Equal<typeof _explicitNever, KnowledgeItemRepository>>,
  Assert<Equal<typeof _emptyTypedWide, KnowledgeItemRepository<KnowledgeItemRecord<unknown>>>>,
  Assert<Equal<typeof _emptyExplicitWide, KnowledgeItemRepository<KnowledgeItemRecord<unknown>>>>,
  Assert<Equal<typeof _emptyWideCallback, KnowledgeItemRepository<KnowledgeItemRecord<unknown>>>>,
  Assert<Equal<typeof _emptyContextCallback, KnowledgeItemRepository>>,
  Assert<Equal<typeof _emptyFreshReadonly, KnowledgeItemRepository>>,
  Assert<Equal<typeof _emptyMutableTuple, KnowledgeItemRepository>>,
  Assert<Equal<typeof _narrowInferred, KnowledgeItemRepository<{ id: string }>>>,
  Assert<Equal<typeof _explicitLegacy, KnowledgeItemRepository>>,
  Assert<Equal<typeof _typedLegacy, KnowledgeItemRepository>>,
  Assert<Equal<typeof _neverMode, KnowledgeItemRepository<KnowledgeItemRecord<never>>>>,
  Assert<Equal<typeof _oldSaved, KnowledgeItemRecord>>,
  Assert<Equal<typeof _saved, KnowledgeItemRecord<unknown>>>,
  Assert<Equal<typeof _savedUpdate, KnowledgeItemRecord<unknown>>>,
  Assert<Equal<typeof _found, KnowledgeItemRecord<unknown> | null>>,
  Assert<Equal<typeof _listed, KnowledgeItemRecord<unknown>[]>>,
  Assert<Equal<typeof _deleted, KnowledgeItemRecord<unknown> | null>>,
  Assert<Equal<typeof _saved.sourceMode, unknown>>,
  Assert<Equal<typeof _inferredSaved, typeof _created>>,
  Assert<Equal<typeof _inferredFound, typeof _created | null>>,
  Assert<Equal<typeof _inferredList, (typeof _created)[]>>,
  Assert<Equal<NonNullable<typeof _taggedFound>['marker'], number>>,
  Assert<Equal<'marker' extends keyof typeof _rebuiltTagged ? true : false, false>>,
  Assert<Equal<typeof _taggedReplacement.marker, number>>,
  Assert<Equal<typeof _fromOptions, KnowledgeItemRepository<KnowledgeItemRecord<unknown>>>>,
  Assert<Equal<typeof _reconstructed.sourceMode, unknown>>,
  Assert<Equal<typeof _projection.sourceMode, unknown>>,
  Assert<Equal<typeof _projection.updatedAt, unknown>>,
  Assert<Equal<typeof ModelBridge, typeof KnowledgeItem>>,
  Assert<Equal<typeof repositoryBridge, typeof repository>>,
  Assert<Equal<Parameters<KnowledgeItemRepository['save']>, [KnowledgeItemRecord, KnowledgeItemSaveOptions?]>>,
  Assert<Equal<ReturnType<KnowledgeItemRepository['save']>, KnowledgeItemRecord>>,
  Assert<Equal<ReturnType<typeof repository>, KnowledgeItemRepository<KnowledgeItemRecord<unknown>>>>,
  Assert<Equal<Parameters<typeof repository>, [KnowledgeItemRepositoryOptions<KnowledgeItemRecord<unknown>>?]>>,
  Assert<Equal<typeof _wideConstructor.title, unknown>>,
  Assert<Equal<typeof _wideConstructor.sourceMode, unknown>>,
  Assert<Equal<typeof _wideInstance.title, string>>,
  Assert<Equal<typeof _wideInstance.userExplanation, unknown>>,
  Assert<Equal<typeof _wideInstance.sourceMode, unknown>>,
  Assert<Equal<IsAny<typeof _updated.sourceMode>, false>>,
  Assert<Equal<IsAny<typeof _saved.sourceMode>, false>>,
  Assert<Equal<IsAny<typeof _projection.sourceMode>, false>>,
  Assert<Equal<IsAny<typeof _wideInstance>, false>>
];
