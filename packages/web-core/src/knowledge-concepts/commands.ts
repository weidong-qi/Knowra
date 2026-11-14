import {
  assertConceptRevision,
  assertConceptState,
  conceptAliases,
  conceptFail,
  conceptId,
  conceptText,
  normalizeConceptName,
  relationKey,
  requireLiveConcept
} from './validation.ts';
import type {
  ConceptCommand,
  ConceptItem,
  ConceptRecord,
  ConceptState,
  KnowledgeConcept,
  KnowledgeConceptLink
} from './types.ts';

export function mergeConceptChanges(state: ConceptState, changed: ConceptState): ConceptState {
  const merge = <T extends ConceptRecord>(before: T[], after: T[]) => [
    ...new Map([...before, ...after].map(row => [row.id, row])).values()
  ];
  return {
    concepts: merge(state.concepts, changed.concepts),
    links: merge(state.links, changed.links),
    relations: merge(state.relations, changed.relations)
  };
}
/** 关联解除后必须一并删除的关系。UI 用它展示确认范围，服务端重新计算并比对。 */
export function invalidConceptRelations(state: ConceptState) {
  const links = new Set(
    state.links.filter(row => !row.deletedAt).map(row => JSON.stringify([row.knowledgeItemId, row.conceptId]))
  );
  return state.relations.filter(
    row =>
      !row.deletedAt &&
      row.basisItemId !== null &&
      ![row.fromConceptId, row.toConceptId].every(id => links.has(JSON.stringify([row.basisItemId, id])))
  );
}
export function conceptRemovalRelations(state: ConceptState, linkIds: readonly string[]) {
  return invalidConceptRelations({ ...state, links: state.links.filter(row => !linkIds.includes(row.id)) });
}
export function applyConceptCommand(
  before: ConceptState,
  items: readonly ConceptItem[],
  command: ConceptCommand,
  context: { now: string; requestHash: string }
): ConceptState {
  conceptId(command.operationId);
  conceptId(command.id);
  if (!/^[a-f0-9]{64}$/.test(context.requestHash) || !Number.isFinite(Date.parse(context.now)))
    conceptFail('CONCEPT_INVALID_INPUT', '命令上下文无效');
  const receipt = before.concepts.flatMap(row => row.operations).find(row => row.id === command.operationId);
  if (receipt) {
    if (receipt.hash !== context.requestHash) conceptFail('CONCEPT_REVISION_CONFLICT', '操作 ID 已用于不同的命令');
    // 返回当前完整值，避免重试时向客户端回灌过时的后像。
    return JSON.parse(JSON.stringify(before)) as ConceptState;
  }
  if ('sourceMode' in command && command.sourceMode !== 'manual')
    conceptFail('CONCEPT_AI_SOURCE_RESERVED', 'AI 来源仅供服务端内部入口使用');
  const state = JSON.parse(JSON.stringify(before)) as ConceptState;
  const touched = { concepts: new Set<string>(), links: new Set<string>(), relations: new Set<string>() };
  const touch = (kind: keyof ConceptState, row: ConceptRecord) => {
    touched[kind].add(row.id);
  };
  const remove = (kind: keyof ConceptState, row: ConceptRecord) => {
    row.deletedAt = context.now;
    row.deletedBy = command.operationId;
    touch(kind, row);
  };
  const fresh = (id: string): ConceptRecord => ({
    id,
    revision: 0,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
    deletedBy: null,
    operationId: command.operationId
  });
  const live = (id: string) => requireLiveConcept(state, id);
  const requireItems = (ids: string[]) => {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
      conceptFail('CONCEPT_INVALID_INPUT', '请选择不重复的知识点');
    for (const id of ids)
      if (typeof id !== 'string' || !id) conceptFail('CONCEPT_INVALID_INPUT', '知识点引用无效');
      else if (!items.some(row => row.id === id && !row.deletedAt))
        conceptFail('CONCEPT_ITEM_NOT_FOUND', '知识点不存在或已在回收站');
  };
  const role = (value: string) => {
    if (!['subject', 'mentions'].includes(value)) conceptFail('CONCEPT_INVALID_INPUT', '关联角色无效');
  };
  const addLinks = (concept: string, ids: string[], value: KnowledgeConceptLink['role']) => {
    requireItems(ids);
    role(value);
    ids.forEach((id, index) => {
      if (state.links.some(row => !row.deletedAt && row.knowledgeItemId === id && row.conceptId === concept))
        conceptFail('CONCEPT_LINK_EXISTS', '知识点已挂入该概念');
      const link = {
        ...fresh(`cl-${context.requestHash}-${index}`),
        conceptId: concept,
        knowledgeItemId: id,
        role: value,
        reviewStatus: 'confirmed' as const,
        sourceMode: 'manual' as const
      };
      state.links.push(link);
      touch('links', link);
    });
  };
  const selectedLinks = (ids: string[]) => {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
      return conceptFail('CONCEPT_INVALID_INPUT', '请选择不重复的关联');
    return ids.map(id => {
      const row = state.links.find(row => row.id === id && row.conceptId === command.id && !row.deletedAt);
      if (!row) return conceptFail('CONCEPT_NOT_FOUND', '关联已变化，请刷新后重试');
      return row;
    });
  };
  const confirmedCascade = (ids: string[] | undefined) => {
    const affected = invalidConceptRelations(state);
    if (JSON.stringify(affected.map(row => row.id).sort()) !== JSON.stringify([...(ids ?? [])].sort()))
      conceptFail('CONCEPT_RELATION_BASIS_INVALID', '受影响的关系已变化，请重新确认删除范围');
    for (const row of affected) remove('relations', row);
  };
  const existingOwner = state.concepts.find(row => row.id === command.id);
  let owner: KnowledgeConcept;
  if (command.type === 'createConcept') {
    if (existingOwner || command.expectedRevision !== 0) conceptFail('CONCEPT_REVISION_CONFLICT', '概念 ID 已存在');
    const name = conceptText(command.name, '名称', true);
    owner = {
      ...fresh(command.id),
      name,
      sense: conceptText(command.sense ?? '', '区分标签'),
      aliases: conceptAliases(command.aliases ?? [], name),
      focus: 'active',
      reviewStatus: 'confirmed',
      sourceMode: 'manual',
      mergedInto: null,
      operations: []
    };
    state.concepts.push(owner);
    if (command.itemIds?.length) addLinks(owner.id, command.itemIds, command.role ?? 'subject');
  } else {
    if (!existingOwner) return conceptFail('CONCEPT_NOT_FOUND', '概念不存在');
    owner = existingOwner;
    if (owner.mergedInto) conceptFail('CONCEPT_MERGED', '概念已合并');
    assertConceptRevision(owner, command.expectedRevision);
    if (command.type !== 'undeleteConcept') live(owner.id);
    switch (command.type) {
      case 'updateConcept': {
        const patch = command.patch;
        if (
          !patch ||
          typeof patch !== 'object' ||
          Array.isArray(patch) ||
          Object.keys(patch).some(key => !['name', 'sense', 'aliases', 'focus'].includes(key))
        )
          conceptFail('CONCEPT_INVALID_INPUT', '修改内容无效');
        if (patch.name !== undefined) owner.name = conceptText(patch.name, '名称', true);
        if (patch.sense !== undefined) owner.sense = conceptText(patch.sense, '区分标签');
        owner.aliases = conceptAliases(patch.aliases ?? owner.aliases, owner.name);
        if (patch.focus !== undefined) {
          if (!['active', 'muted'].includes(patch.focus)) conceptFail('CONCEPT_INVALID_INPUT', '关注状态无效');
          owner.focus = patch.focus;
        }
        break;
      }
      case 'archiveConcept':
        owner.reviewStatus = 'archived';
        break;
      case 'restoreConcept':
        owner.reviewStatus = 'confirmed';
        break;
      case 'deleteConcept':
        remove('concepts', owner);
        state.links.filter(row => !row.deletedAt && row.conceptId === owner.id).forEach(row => remove('links', row));
        state.relations
          .filter(row => !row.deletedAt && [row.fromConceptId, row.toConceptId].includes(owner.id))
          .forEach(row => remove('relations', row));
        break;
      case 'undeleteConcept': {
        if (!owner.deletedAt) conceptFail('CONCEPT_INVALID_INPUT', '概念未被删除');
        const marker = owner.deletedBy;
        const restore = (kind: keyof ConceptState, row: ConceptRecord) => {
          row.deletedAt = null;
          row.deletedBy = null;
          touch(kind, row);
        };
        // 撤销只撤回此次删除；之后发生的永久删除、合并、独立删除仍然有效。
        restore('concepts', owner);
        const resolveEndpoint = (id: string): string | null => {
          const visited = new Set<string>();
          let row = state.concepts.find(row => row.id === id);
          while (row?.mergedInto && !visited.has(row.id)) {
            visited.add(row.id);
            row = state.concepts.find(candidate => candidate.id === row!.mergedInto);
          }
          return row && !row.deletedAt ? row.id : null;
        };
        for (const row of state.links) {
          if (row.deletedBy !== marker || !row.deletedAt) continue;
          const concept = resolveEndpoint(row.conceptId);
          if (
            !concept ||
            !items.some(item => item.id === row.knowledgeItemId) ||
            state.links.some(
              other => !other.deletedAt && other.conceptId === concept && other.knowledgeItemId === row.knowledgeItemId
            )
          )
            continue;
          row.conceptId = concept;
          restore('links', row);
        }
        for (const row of state.relations) {
          if (row.deletedBy !== marker || !row.deletedAt) continue;
          const from = resolveEndpoint(row.fromConceptId);
          const to = resolveEndpoint(row.toConceptId);
          if (!from || !to || from === to) continue;
          const candidate = { ...row, fromConceptId: from, toConceptId: to };
          if (state.relations.some(other => !other.deletedAt && relationKey(other) === relationKey(candidate)))
            continue;
          if (
            row.basisItemId !== null &&
            (!items.some(item => item.id === row.basisItemId) ||
              ![from, to].every(id =>
                state.links.some(
                  link => !link.deletedAt && link.conceptId === id && link.knowledgeItemId === row.basisItemId
                )
              ))
          )
            continue;
          Object.assign(row, candidate);
          restore('relations', row);
        }
        break;
      }
      case 'linkItems':
        addLinks(owner.id, command.itemIds, command.role);
        break;
      case 'setLinkRole':
        role(command.role);
        selectedLinks(command.linkIds).forEach(row => {
          row.role = command.role;
          touch('links', row);
        });
        break;
      case 'unlinkItems':
        selectedLinks(command.linkIds).forEach(row => remove('links', row));
        confirmedCascade(command.deleteRelationIds);
        break;
      case 'moveLinks': {
        const target = live(command.targetId);
        assertConceptRevision(target, command.expectedTargetRevision);
        if (target.id === owner.id) conceptFail('CONCEPT_INVALID_INPUT', '请选择另一个概念');
        for (const row of selectedLinks(command.linkIds)) {
          const existing = state.links.find(
            other => !other.deletedAt && other.conceptId === target.id && other.knowledgeItemId === row.knowledgeItemId
          );
          if (existing) {
            if (row.role === 'subject') existing.role = 'subject';
            touch('links', existing);
            remove('links', row);
          } else {
            row.conceptId = target.id;
            touch('links', row);
          }
        }
        touch('concepts', target);
        confirmedCascade(command.deleteRelationIds);
        break;
      }
      case 'mergeConcept': {
        const target = live(command.targetId);
        assertConceptRevision(target, command.expectedTargetRevision);
        if (target.id === owner.id) conceptFail('CONCEPT_INVALID_INPUT', '不能合并到自身');
        const aliases = [...target.aliases, owner.name, ...owner.aliases].filter(
          name => normalizeConceptName(name) !== normalizeConceptName(target.name)
        );
        target.aliases = conceptAliases(
          [...new Map(aliases.map(name => [normalizeConceptName(name), name])).values()],
          target.name
        );
        for (const row of state.links.filter(row => !row.deletedAt && row.conceptId === owner.id)) {
          const existing = state.links.find(
            other => !other.deletedAt && other.conceptId === target.id && other.knowledgeItemId === row.knowledgeItemId
          );
          if (existing) {
            if (row.role === 'subject') existing.role = 'subject';
            touch('links', existing);
            remove('links', row);
          } else {
            row.conceptId = target.id;
            touch('links', row);
          }
        }
        const seen = new Set<string>();
        for (const row of state.relations.filter(row => !row.deletedAt)) {
          if (row.fromConceptId === owner.id || row.toConceptId === owner.id) {
            if (row.fromConceptId === owner.id) row.fromConceptId = target.id;
            if (row.toConceptId === owner.id) row.toConceptId = target.id;
            touch('relations', row);
          }
          const key = relationKey(row);
          if (row.fromConceptId === row.toConceptId || seen.has(key)) remove('relations', row);
          else seen.add(key);
        }
        owner.mergedInto = target.id;
        remove('concepts', owner);
        touch('concepts', target);
        break;
      }
      case 'createRelation':
      case 'updateRelation': {
        live(command.toConceptId);
        if (command.basisItemId !== null) requireItems([command.basisItemId]);
        let relation = state.relations.find(row => row.id === command.relationId);
        if (command.type === 'createRelation') {
          if (relation) conceptFail('CONCEPT_RELATION_EXISTS', '关系 ID 已存在');
          relation = {
            ...fresh(conceptId(command.relationId)),
            fromConceptId: owner.id,
            toConceptId: command.toConceptId,
            type: command.relationType,
            basisItemId: command.basisItemId,
            reviewStatus: 'confirmed',
            sourceMode: 'manual'
          };
          state.relations.push(relation);
        } else {
          if (!relation || relation.deletedAt || relation.fromConceptId !== owner.id)
            return conceptFail('CONCEPT_NOT_FOUND', '关系不存在');
          assertConceptRevision(relation, command.expectedRelationRevision);
          Object.assign(relation, {
            toConceptId: command.toConceptId,
            type: command.relationType,
            basisItemId: command.basisItemId
          });
        }
        touch('relations', relation);
        break;
      }
      case 'deleteRelation': {
        const row = state.relations.find(
          row => row.id === command.relationId && !row.deletedAt && row.fromConceptId === owner.id
        );
        if (!row) return conceptFail('CONCEPT_NOT_FOUND', '关系不存在');
        assertConceptRevision(row, command.expectedRelationRevision);
        remove('relations', row);
        break;
      }
      default:
        conceptFail('CONCEPT_INVALID_INPUT', '命令类型无效');
    }
  }
  // 所有关系入口（含清理、合并和恢复）统一使旧/新两端的删除确认失效。
  // Set 保证一个命令涉及多条边时，每个端点也只推进一次版本。
  for (const relation of state.relations) {
    if (!touched.relations.has(relation.id)) continue;
    const previous = before.relations.find(row => row.id === relation.id);
    for (const id of [previous?.fromConceptId, previous?.toConceptId, relation.fromConceptId, relation.toConceptId]) {
      const endpoint = state.concepts.find(row => row.id === id);
      if (endpoint) touch('concepts', endpoint);
    }
  }
  owner.operations.push({ id: command.operationId, hash: context.requestHash });
  touch('concepts', owner);
  const changed: ConceptState = { concepts: [], links: [], relations: [] };
  for (const kind of ['concepts', 'links', 'relations'] as const)
    for (const row of state[kind])
      if (touched[kind].has(row.id)) {
        row.revision += 1;
        row.updatedAt = context.now;
        row.operationId = command.operationId;
      }
  assertConceptState(state, items);
  changed.concepts = state.concepts.filter(row => touched.concepts.has(row.id));
  changed.links = state.links.filter(row => touched.links.has(row.id));
  changed.relations = state.relations.filter(row => touched.relations.has(row.id));
  return changed;
}
