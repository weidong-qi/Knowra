import {
  buildCreateLearningObjectiveDto as create,
  buildUpdateLearningObjectiveDto as update,
  type LearningObjectiveDtoInput,
  type CreateLearningObjectiveDto,
  type UpdateLearningObjectiveDto
} from '../src/modules/knowledge/application/dto/learning-objective.dto.ts';
import { buildCreateLearningObjectiveDto as bridge } from '../src/modules/knowledge/application/dto/learning-objective.dto.js';
import {
  LearningObjective,
  type LearningObjectiveConstructorInput
} from '../src/modules/knowledge/domain/learning-objective.js';
import {
  createInMemoryLearningObjectiveRepository,
  type LearningObjectiveRecord
} from '../src/modules/knowledge/infrastructure/assessment-repository.js';
import { createPostgresLearningObjectiveRepository } from '../src/modules/knowledge/infrastructure/postgres/learning-objective-repository.js';
import { createLearningObjectiveService } from '../src/modules/knowledge/application/learning-objective-service.js';
import { createAsyncLearningObjectiveService } from '../src/modules/knowledge/application/postgres-async/learning-objective-service.js';
import { assertLearningObjectiveConfirmable } from '../src/modules/knowledge/application/formal-asset-validation.js';

type Assert<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Action = '' | 'identify' | 'explain' | 'apply' | 'compare' | 'analyze' | 'calculate' | 'design' | 'evaluate';
type Cognitive = '' | 'remember' | 'understand' | 'apply' | 'analyze';
type Difficulty = 'easy' | 'medium' | 'hard' | null;
interface OriginalInput {
  id: string;
  knowledgeItemId: string;
  objective?: string;
  actionVerb?: string;
  cognitiveLevel?: string;
  difficultyHint?: string | null;
  reviewStatus?: string;
  reviewNote?: string | null;
  deletedAt?: string | null;
  order?: unknown;
  createdAt?: string;
  updatedAt?: string;
}
interface OriginalModel {
  id: string;
  knowledgeItemId: string;
  objective: string;
  actionVerb: Action;
  cognitiveLevel: Cognitive;
  difficultyHint: Difficulty;
  reviewStatus: 'candidate' | 'confirmed' | 'archived';
  reviewNote: string | null;
  deletedAt: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}
declare const raw: unknown;
declare const input: LearningObjectiveDtoInput;
const _dto = create(input);
const _patch = update(input);
const _unknown = new LearningObjective(_dto);
const _local = createInMemoryLearningObjectiveRepository();
const _saved = _local.save(_unknown);
const _updated = _local.save(new LearningObjective({ ..._saved, ..._patch }));
const _default = new LearningObjective({ id: 'o', knowledgeItemId: 'k' });
const _string = new LearningObjective({
  id: 'o',
  knowledgeItemId: 'k',
  actionVerb: 'identify',
  cognitiveLevel: 'remember',
  difficultyHint: 'easy'
});
const _oldAssignment: LearningObjective = _string;
declare const originalInput: OriginalInput;
const _oldInputAssignment: LearningObjectiveConstructorInput = originalInput;
const _originalModel: LearningObjective = new LearningObjective(originalInput);
const _record: LearningObjectiveRecord = _unknown;
const _explicitUnknown = new LearningObjective<unknown, unknown, unknown, unknown, unknown>({
  id: 'o',
  knowledgeItemId: 'k',
  actionVerb: raw,
  cognitiveLevel: raw,
  difficultyHint: raw,
  createdAt: raw,
  updatedAt: raw
});
const _object = new LearningObjective({
  id: 'o',
  knowledgeItemId: 'k',
  difficultyHint: { historical: true },
  createdAt: { date: 1 },
  updatedAt: 1n
});
const _number = new LearningObjective({
  id: 'o',
  knowledgeItemId: 'k',
  difficultyHint: 1,
  createdAt: 2,
  updatedAt: false
});
const _null = new LearningObjective({
  id: 'o',
  knowledgeItemId: 'k',
  difficultyHint: null,
  createdAt: null,
  updatedAt: null
});
const _linked = new LearningObjective({ id: 'o', knowledgeItemId: 'k', createdAt: { date: 1 } });
const _never = new LearningObjective<never, never, never, never, never>({ id: 'o', knowledgeItemId: 'k' });
const _undefined = new LearningObjective<undefined, undefined, undefined, undefined, undefined>({
  id: 'o',
  knowledgeItemId: 'k'
});
const _mixed = new LearningObjective<string | number, string | symbol, string | object>({
  id: 'o',
  knowledgeItemId: 'k'
});
assertLearningObjectiveConfirmable(_unknown, { deletedAt: null, reviewStatus: 'confirmed' });
assertLearningObjectiveConfirmable(_default, { deletedAt: null, reviewStatus: 'confirmed' });
// 实际 PG 与服务仍是 JS；以下仅验证接线兼容，不声称其未迁移返回值已经静态安全。
declare const pg: ReturnType<typeof createPostgresLearningObjectiveRepository>;
pg.create(_unknown);
pg.save(_default);
pg.save(new LearningObjective({ id: 'o', knowledgeItemId: 'k', objective: 'Updated objective' }));
const _transaction = <Value>(operation: () => Value): Value => operation();
const _localPorts = {
  repository: createInMemoryLearningObjectiveRepository<LearningObjective>(),
  knowledgeItemRepository: { findById: (_id: unknown) => ({ id: 'k', reviewStatus: 'confirmed' as const }) }
};
const _pgPorts = {
  repository: pg,
  knowledgeItemRepository: { findById: async (_id: unknown) => ({ id: 'k', reviewStatus: 'confirmed' as const }) }
};
createLearningObjectiveService({ ..._localPorts, runTransaction: _transaction }).createCandidate(input);
createAsyncLearningObjectiveService({ ..._pgPorts, runTransaction: _transaction }).createCandidate(input);

declare const wideConstructor: ConstructorParameters<typeof LearningObjective>[0];
declare const wideInstance: InstanceType<typeof LearningObjective>;

// @ts-expect-error includes 未证明动作枚举。
const _badAction: Action = _dto.actionVerb;
// @ts-expect-error unknown 模型不能冒充旧默认枚举/时间戳实例。
const _badDefault: LearningObjective = _unknown;
// @ts-expect-error 真实本地保存不改变 unknown difficulty。
const _badSavedHint: Difficulty = _saved.difficultyHint;
// @ts-expect-error DTO 没验证时间戳字符串。
const _badCreated: string = _dto.createdAt;
// @ts-expect-error 旧默认构造输入保持 string 字段，不能直接承接 DTO。
const _badInput: LearningObjectiveConstructorInput = _dto;
// @ts-expect-error 未特化泛型 ConstructorParameters 是宽输入，不冒充旧输入。
const _badCtorInput: LearningObjectiveConstructorInput = wideConstructor;
// @ts-expect-error 未特化泛型 InstanceType 是宽实例，不冒充旧默认模型。
const _badInstance: LearningObjective = wideInstance;

export type LearningObjectiveDtoContracts = [
  Assert<Equal<Parameters<typeof create>, [LearningObjectiveDtoInput?]>>,
  Assert<Equal<ReturnType<typeof create>, CreateLearningObjectiveDto>>,
  Assert<Equal<ReturnType<typeof update>, UpdateLearningObjectiveDto>>,
  Assert<Equal<typeof bridge, typeof create>>,
  Assert<Equal<CreateLearningObjectiveDto['id'], string>>,
  Assert<Equal<CreateLearningObjectiveDto['knowledgeItemId'], string>>,
  Assert<Equal<CreateLearningObjectiveDto['objective'], string>>,
  Assert<Equal<CreateLearningObjectiveDto['reviewNote'], string | null>>,
  Assert<Equal<CreateLearningObjectiveDto['order'], number>>,
  Assert<Equal<CreateLearningObjectiveDto['actionVerb'], unknown>>,
  Assert<Equal<CreateLearningObjectiveDto['cognitiveLevel'], unknown>>,
  Assert<Equal<CreateLearningObjectiveDto['difficultyHint'], unknown>>,
  Assert<Equal<CreateLearningObjectiveDto['createdAt'], unknown>>,
  Assert<Equal<CreateLearningObjectiveDto['updatedAt'], unknown>>,
  Assert<Equal<UpdateLearningObjectiveDto['objective'], string | undefined>>,
  Assert<Equal<UpdateLearningObjectiveDto['reviewNote'], string | null | undefined>>,
  Assert<Equal<UpdateLearningObjectiveDto['order'], number | undefined>>,
  Assert<Equal<UpdateLearningObjectiveDto['actionVerb'], unknown>>,
  Assert<Equal<UpdateLearningObjectiveDto['cognitiveLevel'], unknown>>,
  Assert<Equal<UpdateLearningObjectiveDto['difficultyHint'], unknown>>,
  Assert<Equal<LearningObjectiveConstructorInput, OriginalInput>>,
  Assert<Equal<LearningObjective, OriginalModel>>,
  Assert<Equal<typeof _default, LearningObjective>>,
  Assert<Equal<typeof _oldAssignment, LearningObjective>>,
  Assert<Equal<typeof _oldInputAssignment, OriginalInput>>,
  Assert<Equal<typeof _originalModel, LearningObjective>>,
  Assert<Equal<typeof _string.actionVerb, Action>>,
  Assert<Equal<typeof _string.cognitiveLevel, Cognitive>>,
  Assert<Equal<typeof _string.difficultyHint, Difficulty>>,
  Assert<Equal<typeof _unknown.actionVerb, string>>,
  Assert<Equal<typeof _unknown.cognitiveLevel, string>>,
  Assert<Equal<typeof _unknown.objective, string>>,
  Assert<Equal<typeof _unknown.difficultyHint, unknown>>,
  Assert<Equal<typeof _unknown.createdAt, unknown>>,
  Assert<Equal<typeof _unknown.updatedAt, unknown>>,
  Assert<Equal<typeof _explicitUnknown, typeof _unknown>>,
  Assert<Equal<typeof _saved, typeof _unknown>>,
  Assert<Equal<typeof _updated.difficultyHint, unknown>>,
  Assert<Equal<typeof _updated.actionVerb, string>>,
  Assert<Equal<typeof _object.difficultyHint, { historical: boolean } | Difficulty>>,
  Assert<Equal<typeof _object.createdAt, { date: number } | string>>,
  Assert<Equal<typeof _object.updatedAt, bigint | { date: number } | string>>,
  Assert<Equal<typeof _number.difficultyHint, number | Difficulty>>,
  Assert<Equal<typeof _number.createdAt, number | string>>,
  Assert<Equal<typeof _number.updatedAt, boolean | number | string>>,
  Assert<Equal<typeof _null.difficultyHint, Difficulty>>,
  Assert<Equal<typeof _null.createdAt, null | string>>,
  Assert<Equal<typeof _null.updatedAt, null | string>>,
  Assert<Equal<typeof _linked.updatedAt, { date: number } | string>>,
  Assert<Equal<typeof _never.actionVerb, Action>>,
  Assert<Equal<typeof _never.cognitiveLevel, Cognitive>>,
  Assert<Equal<typeof _never.difficultyHint, Difficulty>>,
  Assert<Equal<typeof _never.createdAt, string>>,
  Assert<Equal<typeof _never.updatedAt, string>>,
  Assert<Equal<typeof _undefined.actionVerb, Action>>,
  Assert<Equal<typeof _undefined.difficultyHint, Difficulty>>,
  Assert<Equal<typeof _undefined.createdAt, string>>,
  Assert<Equal<typeof _mixed.actionVerb, string>>,
  Assert<Equal<typeof _mixed.cognitiveLevel, string>>,
  Assert<Equal<typeof _mixed.difficultyHint, object | Difficulty>>,
  Assert<Equal<ConstructorParameters<typeof LearningObjective>[0]['actionVerb'], unknown>>,
  Assert<Equal<InstanceType<typeof LearningObjective>['actionVerb'], string>>,
  Assert<Equal<InstanceType<typeof LearningObjective>['difficultyHint'], unknown>>,
  Assert<Equal<InstanceType<typeof LearningObjective>['createdAt'], unknown>>,
  Assert<Equal<IsAny<typeof _dto>, false>>,
  Assert<Equal<IsAny<typeof _unknown>, false>>,
  Assert<Equal<IsAny<typeof _saved>, false>>,
  Assert<Equal<IsAny<typeof _record>, false>>
];
