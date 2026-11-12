/** 校验只读取这些字段，不要求输入已构造成 Question。 */
export interface QuestionStructureInput {
  stem?: unknown;
  questionType?: unknown;
  options?: unknown;
  referenceAnswer?: unknown;
  rubric?: unknown;
}

/** 仅用于原有属性读取；不表示选项已通过校验。 */
interface QuestionOptionReadView {
  id?: unknown;
  text?: unknown;
}

import { validationError } from './knowledge-errors.ts';

const CHOICE_TYPES = new Set<unknown>(['singleChoice', 'multipleChoice']);

export function validateQuestionStructure(question: QuestionStructureInput): true {
  const errors: string[] = [];
  if (!(question.stem as { trim(): unknown } | null | undefined)?.trim()) errors.push('QUESTION_STEM_REQUIRED');
  if (CHOICE_TYPES.has(question.questionType)) {
    const options: readonly unknown[] = Array.isArray(question.options) ? question.options : [];
    if (options.length < 2) errors.push('QUESTION_OPTIONS_REQUIRED');
    if (
      options.some(
        option =>
          !option ||
          typeof option !== 'object' ||
          !String((option as QuestionOptionReadView).id ?? '').trim() ||
          !String((option as QuestionOptionReadView).text ?? '').trim()
      )
    ) {
      errors.push('QUESTION_OPTIONS_INVALID');
    }
    const normalizedOptionIds = options.map(option =>
      String((option as QuestionOptionReadView | null | undefined)?.id ?? '').trim()
    );
    const optionIds = new Set(normalizedOptionIds);
    if (optionIds.size !== normalizedOptionIds.length) {
      errors.push('QUESTION_OPTION_IDS_DUPLICATE');
    }
    const answer = (
      Array.isArray(question.referenceAnswer) ? question.referenceAnswer : [question.referenceAnswer]
    ).map((optionId: unknown) => String(optionId ?? '').trim());
    if (!answer.length || answer.some(id => !id || !optionIds.has(id)))
      errors.push('QUESTION_REFERENCE_ANSWER_INVALID');
    if (question.questionType === 'singleChoice' && answer.length !== 1) errors.push('QUESTION_SINGLE_ANSWER_REQUIRED');
  } else if (question.questionType === 'trueFalse') {
    if (question.referenceAnswer !== true && question.referenceAnswer !== false)
      errors.push('QUESTION_TRUE_FALSE_ANSWER_REQUIRED');
  } else if (question.questionType === 'shortAnswer') {
    const hasAnswer =
      typeof question.referenceAnswer === 'string'
        ? Boolean(question.referenceAnswer.trim())
        : question.referenceAnswer !== null && question.referenceAnswer !== undefined;
    if (!hasAnswer && !question.rubric) errors.push('QUESTION_REFERENCE_OR_RUBRIC_REQUIRED');
  }
  if (!question.referenceAnswer && !question.rubric && question.questionType !== 'trueFalse')
    errors.push('QUESTION_REFERENCE_OR_RUBRIC_REQUIRED');
  if (errors.length) {
    throw validationError('QUESTION_INVALID_STRUCTURE', `Question structure is invalid: ${errors.join(', ')}`);
  }
  return true;
}

export function isQuestionStructureComplete(question: QuestionStructureInput): boolean {
  try {
    validateQuestionStructure(question);
    return true;
  } catch {
    return false;
  }
}
