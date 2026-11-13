/** 概念层：正式关联只指向有效概念；合并实际迁移数据，不提供撤销合并。 */
export interface ConceptRecord {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  operationId: string;
}
export interface KnowledgeConcept extends ConceptRecord {
  name: string;
  sense: string;
  aliases: string[];
  reviewStatus: 'candidate' | 'confirmed' | 'archived';
  sourceMode: 'manual' | 'ai';
  focus: 'active' | 'muted';
  /** 已删除源概念的合并去向，用于审计、同步闭包及显式撤销修复；普通读取和分组不跟随。 */
  mergedInto: string | null;
  /** 随记录持久化、同步和备份的命令回执，保证重启后重试也不重复执行。 */
  operations: { id: string; hash: string }[];
}
export interface KnowledgeConceptLink extends ConceptRecord {
  knowledgeItemId: string;
  conceptId: string;
  role: 'subject' | 'mentions';
  reviewStatus: 'candidate' | 'confirmed';
  sourceMode: 'manual' | 'ai';
}
export const CONCEPT_RELATION_TYPES = [
  'partOf',
  'prerequisiteOf',
  'contrastsWith',
  'causes',
  'appliesTo',
  'relatedTo',
  'isA'
] as const;
export type ConceptRelationType = (typeof CONCEPT_RELATION_TYPES)[number];
export interface KnowledgeConceptRelation extends ConceptRecord {
  fromConceptId: string;
  toConceptId: string;
  type: ConceptRelationType;
  basisItemId: string | null;
  reviewStatus: 'candidate' | 'confirmed';
  sourceMode: 'manual' | 'ai';
}
export interface ConceptState {
  concepts: KnowledgeConcept[];
  links: KnowledgeConceptLink[];
  relations: KnowledgeConceptRelation[];
}
export interface ConceptItem {
  id: string;
  deletedAt?: string | null;
}
export interface ConceptFields {
  name: string;
  sense: string;
  aliases: string[];
  focus: 'active' | 'muted';
}
interface CommandBase {
  operationId: string;
  id: string;
  expectedRevision: number;
}
export type ConceptCommand = CommandBase &
  (
    | {
        type: 'createConcept';
        name: string;
        sense?: string;
        aliases?: string[];
        itemIds?: string[];
        role?: KnowledgeConceptLink['role'];
      }
    | { type: 'updateConcept'; patch: Partial<ConceptFields> }
    | { type: 'archiveConcept' | 'restoreConcept' | 'deleteConcept' | 'undeleteConcept' }
    | { type: 'mergeConcept'; targetId: string; expectedTargetRevision: number }
    | { type: 'linkItems'; itemIds: string[]; role: KnowledgeConceptLink['role'] }
    | { type: 'setLinkRole'; linkIds: string[]; role: KnowledgeConceptLink['role'] }
    | { type: 'unlinkItems'; linkIds: string[]; deleteRelationIds?: string[] }
    | {
        type: 'moveLinks';
        linkIds: string[];
        targetId: string;
        expectedTargetRevision: number;
        deleteRelationIds?: string[];
      }
    | {
        type: 'createRelation';
        relationId: string;
        toConceptId: string;
        relationType: ConceptRelationType;
        basisItemId: string | null;
      }
    | {
        type: 'updateRelation';
        relationId: string;
        expectedRelationRevision: number;
        toConceptId: string;
        relationType: ConceptRelationType;
        basisItemId: string | null;
      }
    | { type: 'deleteRelation'; relationId: string; expectedRelationRevision: number }
  );
export type ConceptRuleCode =
  | 'CONCEPT_NOT_FOUND'
  | 'CONCEPT_REVISION_CONFLICT'
  | 'CONCEPT_NAME_AMBIGUOUS'
  | 'CONCEPT_MERGED'
  | 'CONCEPT_INVALID_INPUT'
  | 'CONCEPT_LINK_EXISTS'
  | 'CONCEPT_ITEM_NOT_FOUND'
  | 'CONCEPT_RELATION_BASIS_INVALID'
  | 'CONCEPT_RELATION_EXISTS'
  | 'CONCEPT_AI_SOURCE_RESERVED';
export class ConceptRuleError extends Error {
  readonly code: ConceptRuleCode;
  constructor(code: ConceptRuleCode, message: string) {
    super(message);
    this.name = 'ConceptRuleError';
    this.code = code;
  }
}
export const emptyConceptState = (): ConceptState => ({ concepts: [], links: [], relations: [] });
