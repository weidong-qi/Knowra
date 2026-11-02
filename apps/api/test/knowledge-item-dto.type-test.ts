import {
  buildCreateKnowledgeItemDto as create,
  buildUpdateKnowledgeItemDto as update,
  buildCreateKnowledgeEvidenceDto as evidence,
  type KnowledgeItemDtoInput,
  type KnowledgeEvidenceDtoInput,
  type CreateKnowledgeItemDto,
  type UpdateKnowledgeItemDto,
  type CreateKnowledgeEvidenceDto
} from '../src/modules/knowledge/application/dto/knowledge-item.dto.ts';
import {
  buildCreateKnowledgeItemDto as createBridge,
  buildUpdateKnowledgeItemDto as updateBridge,
  buildCreateKnowledgeEvidenceDto as evidenceBridge
} from '../src/modules/knowledge/application/dto/knowledge-item.dto.js';

import { KnowledgeItem } from '../src/modules/knowledge/domain/knowledge-item.js';
import { KnowledgeEvidence } from '../src/modules/knowledge/domain/knowledge-evidence.js';
import {
  createInMemoryKnowledgeItemRepository as itemRepository,
  type KnowledgeItemRecord,
  type KnowledgeItemRepository
} from '../src/modules/knowledge/infrastructure/knowledge-item-repository.js';
import {
  createInMemoryKnowledgeEvidenceRepository as evidenceRepository,
  type KnowledgeEvidenceRecord,
  type KnowledgeEvidenceRepository
} from '../src/modules/knowledge/infrastructure/knowledge-evidence-repository.js';
import { toKnowledgeItemWorkspaceDto } from '../src/modules/knowledge/application/workspace-query-dto.js';
import { matchesKnowledgeCandidateRequest } from '../src/modules/knowledge/application/knowledge-candidate-retry.js';
import { assertKnowledgeItemConfirmable } from '../src/modules/knowledge/application/formal-asset-validation.js';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createAppContext } from '../src/app.factory.js';
import { createKnowledgeItemService } from '../src/modules/knowledge/application/knowledge-item-service.js';
import { createAsyncKnowledgeItemService } from '../src/modules/knowledge/application/postgres-async/knowledge-domain-service.js';
import { normalizeKnowledgeChange } from '../src/modules/sync/knowledge-batch-domain.js';

type Assert<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type WideItem = KnowledgeItemRecord<unknown>;
type WideEvidence = KnowledgeEvidenceRecord<unknown, unknown>;
declare const raw: unknown;
declare const input: KnowledgeItemDtoInput;
declare const evidenceInput: KnowledgeEvidenceDtoInput;
const _dto = create(input);
const _patch = update(input);
const _evidenceDto = evidence(evidenceInput);
create({
  id: raw,
  title: raw,
  canonicalStatement: raw,
  userExplanation: raw,
  knowledgeType: raw,
  importance: raw,
  sourceMode: raw,
  createdAt: raw,
  updatedAt: raw
});
update(input);
evidence({
  id: raw,
  sourceType: raw,
  sourceId: raw,
  noteId: raw,
  noteVersionId: raw,
  annotationId: raw,
  expectedAnnotationRevision: raw,
  quoteText: raw,
  headingPath: raw,
  relationType: raw
});
create();
update();
evidence();

// 实际 DTO→模型→显式宽本地工厂，不借用旧 JS any 或断言绕过写入边界。
const _model = new KnowledgeItem(_dto);
const _items = itemRepository<WideItem>();
const _created = _items.create(_model);
const _saved = _items.save(_model);
const _found = _items.findById(_dto.id);
const _listed = _items.list();
const _deleted = _items.delete(_dto.id);
const _updatedModel = new KnowledgeItem({ ..._model, ..._patch });
const _updated = _items.save(_updatedModel);
const _evidenceModel = new KnowledgeEvidence({ ..._evidenceDto, knowledgeItemId: _dto.id });
const _evidence = evidenceRepository<WideEvidence>();
const _evidenceCreated = _evidence.create(_evidenceModel);
const _evidenceSaved = _evidence.save(_evidenceModel);
const _evidenceFound = _evidence.findById(_evidenceDto.id);
const _evidenceListed = _evidence.list();
const _evidenceDeleted = _evidence.deleteByKnowledgeItemId(_dto.id);
const _evidenceMarked = _evidence.markByNoteId(_evidenceDto.noteId, 'stale');
const _projection = toKnowledgeItemWorkspaceDto(_saved, { evidence: _evidenceListed });
const _inferredItems = itemRepository({ records: [_model] });
const _inferredEvidence = evidenceRepository({ records: [_evidenceModel] });
const _inferredItemSaved = _inferredItems.save(_model);
const _inferredEvidenceSaved = _inferredEvidence.save(_evidenceModel);
// 其他已经迁移的消费者使用诚实 unknown 读取端口，不新增 any。
matchesKnowledgeCandidateRequest(_model, _dto, [_evidenceModel], [_evidenceDto]);
assertKnowledgeItemConfirmable(_model, [_evidenceModel]);
assertKnowledgeItemConfirmable(_updatedModel, _evidenceListed);

// 默认窄工厂仍服务旧直接模型调用；本批没有修改默认装配或它们的声明。
const _narrowItems = itemRepository();
const _narrowEvidence = evidenceRepository();
_narrowItems.save(new KnowledgeItem({ id: 'k' }));
_narrowEvidence.save(new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k' }));
itemRepository({ records: [] }).save(new KnowledgeItem({ id: 'k' }));
evidenceRepository({ records: [] }).save(new KnowledgeEvidence({ id: 'e', knowledgeItemId: 'k' }));
// @ts-expect-error 默认窄知识项仓库不能接受 DTO 的未知 sourceMode。
_narrowItems.save(_model);
// @ts-expect-error 默认窄来源仓库不能接受 DTO 的未知 sourceType/relationType。
_narrowEvidence.save(_evidenceModel);
// @ts-expect-error unknown 不能借默认构造赋值重新变为旧模型。
const _badItem: KnowledgeItem = _model;
// @ts-expect-error DTO 来源路径仍 unknown，不冒充标准字符串数组模型。
const _badEvidence: KnowledgeEvidence = _evidenceModel;
// @ts-expect-error update 的第三次文本读取没有字符串保证。
const _badText: string = _patch.title;
// @ts-expect-error 模型会执行原 trim 调用，不保证未知解释的方法结果。
const _badExplanation: string = _updatedModel.userExplanation;
// @ts-expect-error 真实宽仓库不会将来源模式收窄。
const _badMode: KnowledgeItem['sourceMode'] = _saved.sourceMode;
// @ts-expect-error 真实宽仓库不会将路径收窄。
const _badPath: string[] = _evidenceSaved.headingPath;
// @ts-expect-error 服务修订比较字段不保存为模型属性。
const _badRevision = _evidenceModel.expectedAnnotationRevision;
// @ts-expect-error 旧窄写入函数不能冒充宽写入端口。
const _badItemPort: KnowledgeItemRepository<WideItem> = _narrowItems;
// @ts-expect-error 旧窄来源写入函数不能冒充宽写入端口。
const _badEvidencePort: KnowledgeEvidenceRepository<WideEvidence> = _narrowEvidence;

// 实际生产 JS 边界的既有缺口单独记录，不与上面的纯 TS 链混为一谈。
const _module = createKnowledgeModule();
const _app = createAppContext();
const _legacyItemRepository = _module.repositories.knowledgeItemRepository;
const _legacyEvidenceRepository = _module.repositories.knowledgeEvidenceRepository;
const _defaultFromLegacyItems = itemRepository({ records: _legacyItemRepository.list() });
const _defaultFromLegacyEvidence = evidenceRepository({ records: _legacyEvidenceRepository.list() });

export type KnowledgeDtoContracts = [
  Assert<Equal<Parameters<typeof create>, [KnowledgeItemDtoInput?]>>,
  Assert<Equal<ReturnType<typeof create>, CreateKnowledgeItemDto>>,
  Assert<Equal<typeof createBridge, typeof create>>,
  Assert<Equal<Parameters<typeof update>, [KnowledgeItemDtoInput?]>>,
  Assert<Equal<ReturnType<typeof update>, UpdateKnowledgeItemDto>>,
  Assert<Equal<typeof updateBridge, typeof update>>,
  Assert<Equal<Parameters<typeof evidence>, [KnowledgeEvidenceDtoInput?]>>,
  Assert<Equal<ReturnType<typeof evidence>, CreateKnowledgeEvidenceDto>>,
  Assert<Equal<typeof evidenceBridge, typeof evidence>>,
  Assert<Equal<typeof _dto.id, string>>,
  Assert<Equal<typeof _dto.title, string>>,
  Assert<Equal<typeof _dto.canonicalStatement, string>>,
  Assert<Equal<typeof _dto.userExplanation, string>>,
  Assert<Equal<typeof _dto.knowledgeType, unknown>>,
  Assert<Equal<typeof _dto.importance, number | null>>,
  Assert<Equal<typeof _dto.sourceMode, unknown>>,
  Assert<Equal<typeof _dto.createdAt, unknown>>,
  Assert<Equal<typeof _dto.updatedAt, unknown>>,
  Assert<Equal<typeof _patch.title, unknown>>,
  Assert<Equal<typeof _patch.canonicalStatement, unknown>>,
  Assert<Equal<typeof _patch.userExplanation, unknown>>,
  Assert<Equal<typeof _patch.knowledgeType, unknown>>,
  Assert<Equal<typeof _patch.importance, number | null | undefined>>,
  Assert<Equal<typeof _patch.sourceMode, unknown>>,
  Assert<Equal<typeof _evidenceDto.id, string>>,
  Assert<Equal<typeof _evidenceDto.sourceType, unknown>>,
  Assert<Equal<typeof _evidenceDto.sourceId, string | null>>,
  Assert<Equal<typeof _evidenceDto.noteId, string | null>>,
  Assert<Equal<typeof _evidenceDto.noteVersionId, string | null>>,
  Assert<Equal<typeof _evidenceDto.annotationId, string | null>>,
  Assert<Equal<typeof _evidenceDto.expectedAnnotationRevision, unknown>>,
  Assert<Equal<typeof _evidenceDto.quoteText, unknown>>,
  Assert<Equal<typeof _evidenceDto.headingPath, unknown>>,
  Assert<Equal<typeof _evidenceDto.relationType, unknown>>,
  Assert<Equal<typeof _model.id, string>>,
  Assert<Equal<typeof _model.title, string>>,
  Assert<Equal<typeof _model.canonicalStatement, string>>,
  Assert<Equal<typeof _model.userExplanation, string>>,
  Assert<Equal<typeof _model.knowledgeType, unknown>>,
  Assert<Equal<typeof _model.importance, number | null>>,
  Assert<Equal<typeof _model.sourceMode, unknown>>,
  Assert<Equal<typeof _model.createdAt, unknown>>,
  Assert<Equal<typeof _model.updatedAt, unknown>>,
  Assert<Equal<typeof _updatedModel.title, string>>,
  Assert<Equal<typeof _updatedModel.canonicalStatement, string>>,
  Assert<Equal<typeof _updatedModel.userExplanation, unknown>>,
  Assert<Equal<typeof _updatedModel.knowledgeType, unknown>>,
  Assert<Equal<typeof _updatedModel.sourceMode, unknown>>,
  Assert<Equal<typeof _updatedModel.createdAt, unknown>>,
  Assert<Equal<typeof _updatedModel.updatedAt, unknown>>,
  Assert<Equal<typeof _evidenceModel.id, string>>,
  Assert<Equal<typeof _evidenceModel.knowledgeItemId, string>>,
  Assert<Equal<typeof _evidenceModel.sourceType, unknown>>,
  Assert<Equal<typeof _evidenceModel.relationType, unknown>>,
  Assert<Equal<typeof _evidenceModel.headingPath, unknown>>,
  Assert<Equal<typeof _evidenceModel.quoteText, string>>,
  Assert<Equal<typeof _evidenceModel.createdAt, string>>,
  Assert<Equal<typeof _evidenceModel.updatedAt, string>>,
  Assert<Equal<NonNullable<typeof _created>['userExplanation'], unknown>>,
  Assert<Equal<NonNullable<typeof _created>['knowledgeType'], unknown>>,
  Assert<Equal<NonNullable<typeof _created>['sourceMode'], unknown>>,
  Assert<Equal<NonNullable<typeof _created>['createdAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _created>['updatedAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _saved>['userExplanation'], unknown>>,
  Assert<Equal<NonNullable<typeof _saved>['knowledgeType'], unknown>>,
  Assert<Equal<NonNullable<typeof _saved>['sourceMode'], unknown>>,
  Assert<Equal<NonNullable<typeof _saved>['createdAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _saved>['updatedAt'], unknown>>,
  Assert<Equal<(typeof _listed)[number]['userExplanation'], unknown>>,
  Assert<Equal<(typeof _listed)[number]['knowledgeType'], unknown>>,
  Assert<Equal<(typeof _listed)[number]['sourceMode'], unknown>>,
  Assert<Equal<(typeof _listed)[number]['createdAt'], unknown>>,
  Assert<Equal<(typeof _listed)[number]['updatedAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _deleted>['userExplanation'], unknown>>,
  Assert<Equal<NonNullable<typeof _deleted>['knowledgeType'], unknown>>,
  Assert<Equal<NonNullable<typeof _deleted>['sourceMode'], unknown>>,
  Assert<Equal<NonNullable<typeof _deleted>['createdAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _deleted>['updatedAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _found>['userExplanation'], unknown>>,
  Assert<Equal<NonNullable<typeof _found>['knowledgeType'], unknown>>,
  Assert<Equal<NonNullable<typeof _found>['sourceMode'], unknown>>,
  Assert<Equal<NonNullable<typeof _found>['createdAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _found>['updatedAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _updated>['userExplanation'], unknown>>,
  Assert<Equal<NonNullable<typeof _updated>['knowledgeType'], unknown>>,
  Assert<Equal<NonNullable<typeof _updated>['sourceMode'], unknown>>,
  Assert<Equal<NonNullable<typeof _updated>['createdAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _updated>['updatedAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceCreated>['sourceType'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceCreated>['relationType'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceCreated>['headingPath'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceCreated>['quoteText'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceCreated>['createdAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceCreated>['updatedAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceSaved>['sourceType'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceSaved>['relationType'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceSaved>['headingPath'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceSaved>['quoteText'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceSaved>['createdAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceSaved>['updatedAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceFound>['sourceType'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceFound>['relationType'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceFound>['headingPath'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceFound>['quoteText'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceFound>['createdAt'], unknown>>,
  Assert<Equal<NonNullable<typeof _evidenceFound>['updatedAt'], unknown>>,
  Assert<Equal<(typeof _evidenceListed)[number]['sourceType'], unknown>>,
  Assert<Equal<(typeof _evidenceListed)[number]['relationType'], unknown>>,
  Assert<Equal<(typeof _evidenceListed)[number]['headingPath'], unknown>>,
  Assert<Equal<(typeof _evidenceListed)[number]['quoteText'], unknown>>,
  Assert<Equal<(typeof _evidenceListed)[number]['createdAt'], unknown>>,
  Assert<Equal<(typeof _evidenceListed)[number]['updatedAt'], unknown>>,
  Assert<Equal<(typeof _evidenceDeleted)[number]['sourceType'], unknown>>,
  Assert<Equal<(typeof _evidenceDeleted)[number]['relationType'], unknown>>,
  Assert<Equal<(typeof _evidenceDeleted)[number]['headingPath'], unknown>>,
  Assert<Equal<(typeof _evidenceDeleted)[number]['quoteText'], unknown>>,
  Assert<Equal<(typeof _evidenceDeleted)[number]['createdAt'], unknown>>,
  Assert<Equal<(typeof _evidenceDeleted)[number]['updatedAt'], unknown>>,
  Assert<Equal<(typeof _evidenceMarked)[number]['sourceType'], unknown>>,
  Assert<Equal<(typeof _evidenceMarked)[number]['relationType'], unknown>>,
  Assert<Equal<(typeof _evidenceMarked)[number]['headingPath'], unknown>>,
  Assert<Equal<(typeof _evidenceMarked)[number]['quoteText'], unknown>>,
  Assert<Equal<(typeof _evidenceMarked)[number]['createdAt'], unknown>>,
  Assert<Equal<(typeof _evidenceMarked)[number]['updatedAt'], unknown>>,
  Assert<Equal<typeof _projection.userExplanation, unknown>>,
  Assert<Equal<typeof _projection.knowledgeType, unknown>>,
  Assert<Equal<typeof _projection.sourceMode, unknown>>,
  Assert<Equal<typeof _projection.createdAt, unknown>>,
  Assert<Equal<typeof _projection.updatedAt, unknown>>,
  Assert<Equal<typeof _projection.evidenceSummary, unknown>>,
  Assert<Equal<typeof _inferredItemSaved.knowledgeType, unknown>>,
  Assert<Equal<typeof _inferredItemSaved.sourceMode, unknown>>,
  Assert<Equal<typeof _inferredItemSaved.createdAt, unknown>>,
  Assert<Equal<typeof _inferredItemSaved.updatedAt, unknown>>,
  Assert<Equal<typeof _inferredEvidenceSaved.sourceType, unknown>>,
  Assert<Equal<typeof _inferredEvidenceSaved.relationType, unknown>>,
  Assert<Equal<typeof _inferredEvidenceSaved.headingPath, unknown>>,
  Assert<Equal<IsAny<CreateKnowledgeItemDto[keyof CreateKnowledgeItemDto]>, false>>,
  Assert<Equal<IsAny<UpdateKnowledgeItemDto[keyof UpdateKnowledgeItemDto]>, false>>,
  Assert<Equal<IsAny<CreateKnowledgeEvidenceDto[keyof CreateKnowledgeEvidenceDto]>, false>>,
  Assert<Equal<IsAny<typeof _dto>, false>>,
  Assert<Equal<IsAny<typeof _patch>, false>>,
  Assert<Equal<IsAny<typeof _evidenceDto>, false>>,
  Assert<Equal<IsAny<typeof _model>, false>>,
  Assert<Equal<IsAny<typeof _updatedModel>, false>>,
  Assert<Equal<IsAny<typeof _created>, false>>,
  Assert<Equal<IsAny<typeof _saved>, false>>,
  Assert<Equal<IsAny<typeof _found>, false>>,
  Assert<Equal<IsAny<typeof _listed>, false>>,
  Assert<Equal<IsAny<typeof _evidenceModel>, false>>,
  Assert<Equal<IsAny<typeof _evidenceSaved>, false>>,
  Assert<Equal<IsAny<typeof _projection>, false>>,
  Assert<Equal<typeof _narrowItems, KnowledgeItemRepository>>,
  Assert<Equal<typeof _narrowEvidence, KnowledgeEvidenceRepository>>
];

export type ExistingJavascriptBoundaryLimitations = [
  Assert<Equal<IsAny<typeof _legacyItemRepository>, true>>,
  Assert<Equal<IsAny<typeof _legacyEvidenceRepository>, true>>,
  Assert<Equal<IsAny<typeof _app.modules.knowledge.repositories.knowledgeItemRepository>, true>>,
  Assert<Equal<IsAny<typeof _app.modules.knowledge.repositories.knowledgeEvidenceRepository>, true>>,
  Assert<Equal<IsAny<ReturnType<ReturnType<typeof createKnowledgeItemService>['createCandidate']>>, false>>,
  Assert<Equal<IsAny<ReturnType<ReturnType<typeof createKnowledgeItemService>['updateItem']>>, false>>,
  Assert<Equal<IsAny<ReturnType<ReturnType<typeof createKnowledgeItemService>['createEvidence']>>, true>>,
  Assert<
    Equal<IsAny<Awaited<ReturnType<ReturnType<typeof createAsyncKnowledgeItemService>['createCandidate']>>>, false>
  >,
  Assert<Equal<IsAny<Awaited<ReturnType<ReturnType<typeof createAsyncKnowledgeItemService>['updateItem']>>>, true>>,
  Assert<Equal<IsAny<Awaited<ReturnType<ReturnType<typeof createAsyncKnowledgeItemService>['createEvidence']>>>, true>>,
  Assert<Equal<IsAny<ReturnType<typeof normalizeKnowledgeChange>>, true>>,
  Assert<
    Equal<'repository' extends keyof NonNullable<Parameters<typeof createKnowledgeItemService>[0]> ? true : false, true>
  >,
  Assert<
    Equal<
      'evidenceRepository' extends keyof NonNullable<Parameters<typeof createKnowledgeItemService>[0]> ? true : false,
      true
    >
  >,
  Assert<
    Equal<
      'repository' extends keyof NonNullable<Parameters<typeof createAsyncKnowledgeItemService>[0]> ? true : false,
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
  Assert<Equal<typeof _defaultFromLegacyItems, KnowledgeItemRepository>>,
  Assert<Equal<typeof _defaultFromLegacyEvidence, KnowledgeEvidenceRepository>>
];
