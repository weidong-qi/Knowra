import { randomUUID } from 'node:crypto';

export interface PreviousQuestionObjectiveRecord {
  learningObjectiveId?: unknown;
  id?: unknown;
  createdAt?: unknown;
}

/** 仅描述实际写出的字段；旧关系的 ID/时间戳和迭代器元素均未经验证。 */
export interface QuestionObjectiveIdentityRecord<
  Id = unknown,
  QuestionId = unknown,
  ObjectiveId = unknown,
  CreatedAt = unknown
> {
  id: Id;
  questionId: QuestionId;
  learningObjectiveId: ObjectiveId;
  isPrimary: boolean;
  order: number;
  createdAt: CreatedAt;
}
type IdentityCreatedAt<Value> = Value extends undefined ? string : Value;

/** 存活关系保持身份；解除后重建同一组合使用新 ID，不能复活删除墓碑。 */
export function questionObjectiveRecords<
  QuestionId,
  ObjectiveId,
  Previous extends PreviousQuestionObjectiveRecord,
  CreatedAt
>(
  questionId: QuestionId,
  objectiveIds: Iterable<ObjectiveId> | null | undefined,
  previous: readonly Previous[],
  createdAt: CreatedAt
): QuestionObjectiveIdentityRecord<
  NonNullable<Previous['id']> | string,
  QuestionId,
  ObjectiveId,
  NonNullable<Previous['createdAt']> | IdentityCreatedAt<CreatedAt>
>[];
export function questionObjectiveRecords(
  questionId: unknown,
  objectiveIds: Iterable<unknown> | null | undefined,
  previous?: readonly PreviousQuestionObjectiveRecord[],
  createdAt?: unknown
): QuestionObjectiveIdentityRecord[];
export function questionObjectiveRecords(
  questionId: unknown,
  objectiveIds: Iterable<unknown> | null | undefined,
  previous: readonly PreviousQuestionObjectiveRecord[] = [],
  createdAt: unknown = new Date().toISOString()
): QuestionObjectiveIdentityRecord[] {
  const byObjective = new Map(previous.map(record => [record.learningObjectiveId, record]));
  return [...new Set(objectiveIds)].map((learningObjectiveId, order) => {
    const current = byObjective.get(learningObjectiveId);
    return {
      id: current?.id ?? `question-objective-${randomUUID()}`,
      questionId,
      learningObjectiveId,
      isPrimary: order === 0,
      order,
      createdAt: current?.createdAt ?? createdAt
    };
  });
}
