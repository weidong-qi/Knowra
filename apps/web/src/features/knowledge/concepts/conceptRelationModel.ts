import type {
  ConceptRelationType,
  ConceptRelationProjection,
  KnowledgeConcept,
  KnowledgeConceptRelation
} from '@study-accelerator/web-core';

export const CONCEPT_RELATION_LABELS: Record<ConceptRelationType, string> = {
  partOf: '是…的组成部分',
  prerequisiteOf: '是…的前置知识',
  contrastsWith: '对比',
  causes: '导致',
  appliesTo: '适用于',
  relatedTo: '相关',
  isA: '是一种'
};
export const isSymmetricRelation = (type: ConceptRelationType) => type === 'relatedTo' || type === 'contrastsWith';
export type RelationEditor = {
  owner: KnowledgeConcept;
  relation?: KnowledgeConceptRelation;
  projection?: ConceptRelationProjection;
  deleting?: boolean;
};
