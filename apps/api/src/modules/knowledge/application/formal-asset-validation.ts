import type { QuestionStructureInput } from './question-validation.ts';
import type { EvidenceApplicabilityInput } from '../domain/evidence-applicability.ts';

export interface KnowledgeItemConfirmationInput {
  title?: string | null;
  canonicalStatement?: string | null;
  sourceMode?: unknown;
}

export interface ConfirmedAssetReference {
  deletedAt?: unknown;
  reviewStatus?: unknown;
}

export interface LearningObjectiveConfirmationInput {
  objective?: string | null;
  actionVerb?: string | null;
  cognitiveLevel?: unknown;
}

export interface QuestionSourceInput {
  sourceType?: unknown;
  sourceId?: unknown;
  quote?: unknown;
  locator?: unknown;
  contentHash?: unknown;
}

export interface QuestionSourceReference extends ConfirmedAssetReference, EvidenceApplicabilityInput {
  isCurrent?: unknown;
  contentHash?: unknown;
}

export interface QuestionConfirmationContext {
  objectives?: readonly (ConfirmedAssetReference | null | undefined)[];
  sources?: readonly ({ status?: unknown } | null | undefined)[];
}

export type DerivedQuestionSourceStatus = 'active' | 'stale';

import { validateQuestionStructure } from './question-validation.ts';
import { validationError } from './knowledge-errors.ts';
import { isEvidenceUsable } from '../domain/evidence-applicability.ts';

const ACTION_VERB_LEVELS: Readonly<Record<string, unknown>> = Object.freeze({
  identify: new Set(['remember']),
  explain: new Set(['understand']),
  apply: new Set(['apply']),
  calculate: new Set(['apply']),
  compare: new Set(['analyze']),
  analyze: new Set(['analyze']),
  design: new Set(['analyze']),
  evaluate: new Set(['analyze'])
});

const VAGUE_OBJECTIVE_PREFIX = /^(?:能够|能|可以)?\s*(?:了解|熟悉|掌握)/u;

export function assertKnowledgeItemConfirmable(
  item: KnowledgeItemConfirmationInput | null | undefined,
  evidence: readonly (EvidenceApplicabilityInput | null | undefined)[] = []
): true {
  if (!item?.title?.trim?.() || !item?.canonicalStatement?.trim?.()) {
    throw validationError(
      'KNOWLEDGE_ITEM_CONTENT_REQUIRED',
      'Confirmed KnowledgeItem requires title and canonicalStatement'
    );
  }
  const hasValidEvidence = evidence.some(isEvidenceUsable);
  if (!hasValidEvidence && item.sourceMode !== 'manual') {
    throw validationError(
      'KNOWLEDGE_ITEM_SOURCE_REQUIRED',
      'Confirmed KnowledgeItem requires valid evidence or an explicit manual source'
    );
  }
  return true;
}

export function assertLearningObjectiveConfirmable(
  objective: LearningObjectiveConfirmationInput | null | undefined,
  knowledgeItem: ConfirmedAssetReference | null | undefined
): true {
  if (!knowledgeItem || knowledgeItem.deletedAt || knowledgeItem.reviewStatus !== 'confirmed') {
    throw validationError(
      'KNOWLEDGE_ITEM_NOT_CONFIRMED',
      'LearningObjective confirmation requires a confirmed KnowledgeItem'
    );
  }
  if (!objective?.objective?.trim?.() || !objective?.actionVerb || !objective?.cognitiveLevel) {
    throw validationError(
      'LEARNING_OBJECTIVE_CONTENT_REQUIRED',
      'Confirmed LearningObjective requires objective, actionVerb and cognitiveLevel'
    );
  }
  if (VAGUE_OBJECTIVE_PREFIX.test(objective.objective.trim())) {
    throw validationError(
      'LEARNING_OBJECTIVE_VAGUE_VERB',
      'LearningObjective must use an observable action instead of 了解、熟悉 or 掌握'
    );
  }
  // 保留动态原型属性读取和原 has 调用；此视图不验证未知 actionVerb。
  const compatibleLevels = ACTION_VERB_LEVELS[objective.actionVerb] as
    { has(value: unknown): unknown } | null | undefined;
  if (!compatibleLevels?.has(objective.cognitiveLevel)) {
    throw validationError(
      'LEARNING_OBJECTIVE_COGNITIVE_LEVEL_MISMATCH',
      'LearningObjective actionVerb and cognitiveLevel are incompatible'
    );
  }
  return true;
}

export function deriveQuestionSourceStatus(
  source: QuestionSourceInput | null | undefined,
  reference: QuestionSourceReference | null = null
): DerivedQuestionSourceStatus {
  switch (source?.sourceType) {
    case 'manual':
      return hasManualSourceDeclaration(source) ? 'active' : 'stale';
    case 'knowledgeItem':
      return reference && !reference.deletedAt && reference.reviewStatus === 'confirmed' ? 'active' : 'stale';
    case 'learningObjective':
      return reference && !reference.deletedAt && reference.reviewStatus === 'confirmed' ? 'active' : 'stale';
    case 'noteVersion':
      return reference &&
        reference.isCurrent !== false &&
        (!source.contentHash || source.contentHash === reference.contentHash)
        ? 'active'
        : 'stale';
    case 'knowledgeEvidence':
      return isEvidenceUsable(reference) ? 'active' : 'stale';
    default:
      return 'stale';
  }
}

export function assertQuestionConfirmable(
  question: QuestionStructureInput,
  { objectives = [], sources = [] }: QuestionConfirmationContext = {}
): true {
  validateQuestionStructure(question);
  if (!objectives.length) {
    throw validationError('QUESTION_OBJECTIVES_REQUIRED', 'Question requires at least one LearningObjective');
  }
  if (objectives.some(objective => objective?.deletedAt || objective?.reviewStatus !== 'confirmed')) {
    throw validationError(
      'LEARNING_OBJECTIVE_NOT_CONFIRMED',
      'Question requires all LearningObjectives to be confirmed'
    );
  }
  if (!sources.length) {
    throw validationError('QUESTION_SOURCE_REQUIRED', 'Question requires at least one QuestionSource');
  }
  if (sources.some(source => source?.status !== 'active')) {
    throw validationError('QUESTION_SOURCE_INVALID', 'Question contains an unhealthy QuestionSource');
  }
  return true;
}

function hasManualSourceDeclaration(source: QuestionSourceInput): boolean {
  if (typeof source?.sourceId === 'string' && source.sourceId.trim()) return true;
  if (typeof source?.quote === 'string' && source.quote.trim()) return true;
  return Boolean(
    source?.locator &&
    typeof source.locator === 'object' &&
    !Array.isArray(source.locator) &&
    Object.keys(source.locator).length
  );
}
