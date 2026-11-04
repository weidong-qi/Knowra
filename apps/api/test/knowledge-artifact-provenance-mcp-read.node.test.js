import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { buildKnowledgeProposalPlan } from '../src/modules/ai/knowledge-propose-tool.js';
import { createKnowledgeArtifactProvenanceFromMcpProposal } from '../src/modules/ai/agent-knowledge-provenance.ts';
import { createMcpKnowledgeReadService } from '../src/modules/ai/mcp-knowledge-read.js';
import {
  createLegacyKnowledgeArtifactProvenance,
  hashKnowledgeArtifactProvenance
} from '../src/modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';

const copy = value => structuredClone(value);
const hidden = {
  code: 'MCP_ENTITY_UNAVAILABLE',
  statusCode: 404,
  status: 404,
  message: '对象不存在或不在当前授权范围。'
};
const seal = ({ provenanceHash, ...record }) => ({
  ...record,
  provenanceHash: hashKnowledgeArtifactProvenance(record)
});

async function fixture({ automatic = false, count = 2 } = {}) {
  const pairing = { pairingId: 'pairing-1' },
    grantId = 'grant-1',
    space = { id: 'space-1', userId: 'owner-1' };
  const state = {
    notes: [],
    versions: [],
    items: [],
    evidence: [],
    records: [],
    calls: [],
    folders: [],
    identity: { datasetId: 'dataset-1', datasetEpoch: 'epoch-1' },
    allowed: true,
    finalChecks: 0
  };
  state.grant = {
    grantId,
    policyId: 'policy-1',
    ownerId: 'owner-1',
    actorId: 'owner-1',
    ...state.identity,
    spaceId: space.id,
    policyRevision: 1,
    allowedTools: ['notes_read', 'notes_search'],
    expiresAt: '2099-01-01T00:00:00.000Z'
  };
  state.policy = {
    policyId: 'policy-1',
    ownerId: 'owner-1',
    actorId: 'owner-1',
    ...state.identity,
    spaceId: space.id,
    revision: 1,
    read: true,
    revokedAt: null,
    scope: { kind: 'library' },
    excludedNoteIds: [],
    expiresAt: '2099-01-01T00:00:00.000Z'
  };
  for (let index = 0; index < count; index++) {
    const content = `第${index + 1}条公开的笔记原文😀。`;
    state.notes.push({
      id: `note-${index}`,
      spaceId: space.id,
      title: `笔记 ${index}`,
      rawMarkdown: content,
      deleted: false,
      aiVisibility: 'normal'
    });
    state.versions.push({
      id: `version-${index}`,
      noteId: `note-${index}`,
      content,
      contentHash: calculateContentHash(content)
    });
  }
  const access = {
    async assertSearchGrant() {
      if (!state.allowed) throw new Error('grant revoked');
    },
    async verifyRead({ noteId }) {
      if (!state.allowed) throw new Error('grant revoked');
      const note = state.notes.find(value => value.id === noteId),
        version = state.versions.find(value => value.noteId === noteId);
      if (!note || note.deleted || note.aiVisibility !== 'normal' || note.excluded || note.spaceId !== space.id)
        throw new Error('source hidden');
      return copy({ note, version, contentHash: calculateContentHash(note.rawMarkdown) });
    },
    async assertSearchSources({ sourceRefs }) {
      state.finalChecks++;
      await state.beforeFinal?.();
      for (const ref of sourceRefs) {
        const value = await access.verifyRead({ noteId: ref.noteId });
        if (value.contentHash !== ref.contentHash) throw new Error('source changed');
      }
    }
  };
  const input = {
    candidates: state.notes.map((note, index) => ({
      title: `模型改写标题 ${index}`,
      canonicalStatement: `不是原文子串的模型改写陈述 ${index}`,
      knowledgeType: 'concept',
      citations: [{ noteId: note.id, quote: note.rawMarkdown }]
    })),
    ...(automatic ? {} : { idempotencyKey: 'call-key-0001' })
  };
  const callId = input.idempotencyKey ?? `auto-${calculateContentHash(JSON.stringify(input.candidates)).slice(0, 32)}`;
  const plan = await buildKnowledgeProposalPlan({
    access,
    grantId,
    args: { candidates: input.candidates },
    turnId: `mcp-${pairing.pairingId}`,
    callId,
    sourceRefs: state.versions.map(version => ({
      noteId: version.noteId,
      noteVersionId: version.id,
      contentHash: version.contentHash,
      start: 0,
      end: version.content.length,
      quoteHash: version.contentHash
    }))
  });
  for (const candidate of plan.candidates) {
    const { evidence, ...item } = candidate.candidateInput;
    state.items.push({
      ...item,
      reviewStatus: 'candidate',
      deletedAt: null,
      userExplanation: '不得外发的私人解释',
      updatedAt: '2026-10-09T00:00:00.000Z'
    });
    state.evidence.push(
      ...evidence.map(value => ({ ...value, knowledgeItemId: item.id, status: 'valid', applicabilityStatus: 'active' }))
    );
    state.records.push(
      createKnowledgeArtifactProvenanceFromMcpProposal({
        plan,
        candidate,
        origin: { pairingId: pairing.pairingId, callId },
        committedAt: '2026-10-09T00:00:00.000Z'
      })
    );
  }
  const candidates = state.items.map(item => ({
    candidateId: item.id,
    title: '核心 API 的标题也不得外发',
    knowledgeType: 'concept',
    citationCount: 1
  }));
  const repositories = {
    knowledgeItemRepository: {
      findById: value => state.items.find(item => item.id === value) ?? null,
      list: () => state.items
    },
    knowledgeEvidenceRepository: {
      list: ({ knowledgeItemId }) => state.evidence.filter(value => value.knowledgeItemId === knowledgeItemId)
    },
    knowledgeArtifactProvenanceRepository: {
      list: () => state.records,
      findByArtifactId: artifactId => state.records.find(value => value.artifactId === artifactId) ?? null
    },
    noteVersionRepository: {
      findById: value => state.versions.find(version => version.id === value) ?? null,
      findByNoteIdAndContentHash: (noteId, contentHash) =>
        state.versions.find(version => version.noteId === noteId && version.contentHash === contentHash) ?? null
    },
    knowledgeSpaceRepository: { findById: value => (value === space.id ? space : null) },
    noteRepository: {
      findById: value => state.notes.find(note => note.id === value) ?? null,
      list: ({ spaceId } = {}) => state.notes.filter(note => !spaceId || note.spaceId === spaceId)
    },
    folderRepository: {
      findById: value => state.folders.find(folder => folder.id === value) ?? null,
      list: ({ spaceId } = {}) => state.folders.filter(folder => !spaceId || folder.spaceId === spaceId)
    }
  };
  const knowledgeCommit = {
    async findCommitted(args) {
      state.calls.push(copy(args));
      await state.onLookup?.();
      if (args.origin.pairingId !== pairing.pairingId || args.origin.callId !== callId || state.noReceipt) return null;
      return { requestId: plan.requestId, candidates: copy(state.receiptCandidates ?? candidates) };
    }
  };
  const accessStore = {
    identity: async () => copy(state.identity),
    peekIdentity: () => copy(state.identity),
    peek: (kind, value) =>
      !state.allowed
        ? null
        : kind === 'aiRunGrant' && value === grantId
          ? copy(state.grant)
          : kind === 'aiAccessPolicy' && value === 'policy-1'
            ? copy(state.policy)
            : null
  };
  const service = createMcpKnowledgeReadService({
    knowledge: { repositories },
    ownerId: 'owner-1',
    accessStore,
    knowledgeCommit
  });
  const args = { grantId, access, pairing };
  return {
    state,
    service,
    repositories,
    accessStore,
    args,
    space,
    input,
    callId,
    plan,
    get: () => service.proposalGet({ ...args, requestId: plan.requestId }),
    receipt: reused => service.proposalReceipt({ ...args, input, reused }),
    listKnowledge: () => service.knowledgeList(args),
    readKnowledge: knowledgeId => service.knowledgeRead({ ...args, knowledgeId: knowledgeId ?? state.items[0].id })
  };
}

test('MCP 提议回执：只返回账本确认的稳定 ID，手工和自动幂等键重试一致', async () => {
  for (const automatic of [false, true]) {
    const f = await fixture({ automatic });
    const first = await f.receipt(false),
      reused = await f.receipt(true);
    assert.deepEqual(first, {
      requestId: f.plan.requestId,
      candidateIds: f.state.items.map(item => item.id),
      saved: true,
      reused: false
    });
    assert.deepEqual(reused, { ...first, reused: true });
    assert.deepEqual(f.state.calls[0], {
      origin: { pairingId: f.args.pairing.pairingId, callId: f.callId },
      identity: f.state.identity,
      mode: 'mcp'
    });
    assert(f.state.finalChecks >= 2);
    assert(!JSON.stringify(first).includes('标题'));
    assert(!JSON.stringify(first).includes('解释'));
  }
});

test('MCP 提议状态：保留审核状态，软删除/缺失映射 unavailable，不泄露修改后的知识正文', async () => {
  const f = await fixture({ count: 6 });
  ['candidate', 'confirmed', 'needsRevision', 'archived', 'confirmed', 'candidate'].forEach((status, index) => {
    f.state.items[index].reviewStatus = status;
    f.state.items[index].title = '后续编辑的私密标题';
    f.state.items[index].canonicalStatement = '后续编辑的私密正文';
  });
  f.state.items[4].deletedAt = '2026-10-09T00:00:00.000Z';
  const missing = f.state.items.pop();
  const result = await f.get();
  assert.deepEqual(
    result.candidates.map(value => value.reviewStatus),
    ['candidate', 'confirmed', 'needsRevision', 'archived', 'unavailable', 'unavailable']
  );
  assert.equal(result.candidateIds.at(-1), missing.id);
  assert.deepEqual(Object.keys(result), ['requestId', 'candidateIds', 'candidates']);
  assert(!JSON.stringify(result).includes('私密'));
});

test('MCP 提议回读：跨配对、未知请求和不存在的回执使用同一无内容错误', async () => {
  const f = await fixture();
  await assert.rejects(
    f.service.proposalGet({ ...f.args, pairing: { pairingId: 'other-pairing' }, requestId: f.plan.requestId }),
    hidden
  );
  await assert.rejects(f.service.proposalGet({ ...f.args, requestId: 'missing-request' }), hidden);
  f.state.noReceipt = true;
  await assert.rejects(f.get(), hidden);
  await assert.rejects(f.receipt(false), hidden);
});

test('MCP 提议回读：任一批次来源私密、删除、范围外或非当前版本整体拒绝', async () => {
  const mutations = [
    f => {
      f.state.notes[1].aiVisibility = 'private';
    },
    f => {
      f.state.notes[1].deleted = true;
    },
    f => {
      f.state.notes[1].excluded = true;
    },
    f => {
      f.state.notes[1].spaceId = 'outside';
    },
    f => {
      f.state.notes[1].rawMarkdown += '已改变';
    },
    f => {
      f.state.versions[1].contentHash = 'f'.repeat(64);
    },
    f => {
      f.space.userId = 'other-owner';
    },
    f => {
      f.state.allowed = false;
    }
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(f.get(), hidden);
    await assert.rejects(f.receipt(false), hidden);
  }
});

test('MCP 提议回读：缺失/旧来源、断链证据、撤回证据和批次成员篡改全部关闭', async () => {
  const mutations = [
    f => {
      f.state.records.pop();
    },
    f => {
      f.state.records[1] = createLegacyKnowledgeArtifactProvenance(f.state.items[1].id);
    },
    f => {
      f.state.records[1].provenanceHash = 'f'.repeat(64);
    },
    f => {
      f.state.evidence[1].noteId = 'note-0';
    },
    f => {
      f.state.evidence[1].applicabilityStatus = 'withdrawn';
    },
    f => {
      f.state.evidence.push({
        id: 'manual-secret',
        knowledgeItemId: f.state.items[0].id,
        sourceType: 'manual',
        status: 'valid',
        applicabilityStatus: 'active'
      });
    },
    f => {
      f.state.receiptCandidates = [{ candidateId: f.state.items[0].id }];
    },
    f => {
      f.state.records[1] = seal({ ...f.state.records[1], outputHash: 'f'.repeat(64) });
    }
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(f.get(), hidden);
    await assert.rejects(f.receipt(false), hidden);
  }
});

test('MCP 提议回读：摘要以外新增的证据也属于必须授权的完整闭包', async () => {
  const f = await fixture();
  f.state.notes.push({
    id: 'secret',
    spaceId: f.space.id,
    title: '秘密',
    rawMarkdown: '秘密',
    aiVisibility: 'private'
  });
  f.state.versions.push({
    id: 'secret-version',
    noteId: 'secret',
    content: '秘密',
    contentHash: calculateContentHash('秘密')
  });
  f.state.evidence.push({
    id: 'additional-evidence',
    knowledgeItemId: f.state.items[0].id,
    noteId: 'secret',
    noteVersionId: 'secret-version',
    sourceType: 'noteVersion',
    quoteText: '秘密',
    status: 'valid',
    applicabilityStatus: 'active'
  });
  await assert.rejects(f.get(), hidden);
});

test('MCP 提议回读：最终批量来源复核阻止读取期间切私密', async () => {
  const f = await fixture();
  f.state.beforeFinal = () => {
    f.state.notes[0].aiVisibility = 'private';
  };
  await assert.rejects(f.get(), hidden);
  assert.equal(f.state.finalChecks, 1);
});

test('MCP 提议回读：最终复取知识、全部证据、摘要与数据集身份，阻止混合快照', async () => {
  for (const which of ['item', 'evidence', 'provenance', 'identity']) {
    const f = await fixture();
    let reads = 0;
    const original = f.args.access.verifyRead;
    f.args.access.verifyRead = async args => {
      const result = await original(args);
      if (++reads === 3) {
        if (which === 'item') f.state.items[0].reviewStatus = 'confirmed';
        if (which === 'evidence') f.state.evidence.push({ ...f.state.evidence[0], id: 'new-evidence' });
        if (which === 'provenance') f.state.records[0] = seal({ ...f.state.records[0], modelId: 'changed' });
        if (which === 'identity') f.state.identity.datasetEpoch = 'next-epoch';
      }
      return result;
    };
    await assert.rejects(f.get(), hidden);
  }
});

test('MCP 提议回读：全部来源可读的旧版本 alias 可按相同内容哈希解析', async () => {
  const f = await fixture({ count: 1 });
  const version = f.state.versions[0];
  f.state.versions.push({ ...version, id: 'alias-version' });
  f.state.evidence[0].noteVersionId = 'alias-version';
  assert.equal((await f.get()).candidates[0].reviewStatus, 'candidate');
  f.state.versions[0].contentHash = 'f'.repeat(64);
  await assert.rejects(f.get(), hidden);
});

test('MCP 独立知识授权：改写正文、用户解释和后续编辑原样返回固定 DTO，不要求原文子串', async () => {
  const f = await fixture();
  f.state.items[0].userExplanation = '用户单独授权外发的解释';
  const first = await f.readKnowledge();
  assert.deepEqual(Object.keys(first), [
    'knowledgeId',
    'title',
    'canonicalStatement',
    'userExplanation',
    'knowledgeType',
    'reviewStatus',
    'sourceMode',
    'updatedAt',
    'sources'
  ]);
  assert.equal(first.title, f.state.items[0].title);
  assert.equal(first.canonicalStatement, f.state.items[0].canonicalStatement);
  assert.equal(first.userExplanation, '用户单独授权外发的解释');
  assert.deepEqual(first.sources, [
    { noteId: 'note-0', noteVersionId: 'version-0', contentHash: f.state.versions[0].contentHash }
  ]);
  f.state.items[0].canonicalStatement = '再次编辑后的独立派生陈述';
  f.state.items[0].updatedAt = '2026-10-09T00:01:00.000Z';
  assert.equal((await f.readKnowledge()).canonicalStatement, '再次编辑后的独立派生陈述');
});

test('MCP 独立知识授权：无来源手工知识和未知旧来源按当前数据集授权，不虚构笔记归属', async () => {
  const f = await fixture();
  f.state.items.push({ ...f.state.items[0], id: 'manual-knowledge', sourceMode: 'manual', title: '手工知识' });
  f.state.records[0] = createLegacyKnowledgeArtifactProvenance(f.state.items[0].id);
  f.state.records.splice(1, 1);
  const manual = await f.readKnowledge('manual-knowledge');
  assert.equal(manual.title, '手工知识');
  assert.deepEqual(manual.sources, []);
  assert.equal((await f.listKnowledge()).length, 3);
  f.state.notes[0].aiVisibility = 'private';
  await assert.rejects(f.readKnowledge(f.state.items[0].id), hidden);
  assert.deepEqual(
    (await f.listKnowledge()).map(value => value.knowledgeId),
    [f.state.items[1].id, 'manual-knowledge'].sort((a, b) => a.localeCompare(b))
  );
});

test('MCP 独立知识授权：领域退役的有效证据仍检查全部已知来源，不能绕过隐私', async () => {
  const f = await fixture();
  f.state.evidence[0].applicabilityStatus = 'withdrawn';
  assert.equal((await f.readKnowledge()).knowledgeId, f.state.items[0].id);
  f.state.evidence.push({
    ...f.state.evidence[1],
    id: 'retired-second-source',
    knowledgeItemId: f.state.items[0].id,
    applicabilityStatus: 'withdrawn',
    status: 'valid'
  });
  assert.equal((await f.readKnowledge()).sources.length, 2);
  f.state.notes[1].aiVisibility = 'private';
  await assert.rejects(f.readKnowledge(), hidden);
  assert.deepEqual(await f.listKnowledge(), []);
});

test('MCP 独立知识授权：不把已知来源断链、私密、删除、跨空间或旧正文降级成未知来源', async () => {
  const mutations = [
    f => {
      f.state.notes[0].aiVisibility = 'private';
    },
    f => {
      f.state.notes[0].deleted = true;
    },
    f => {
      f.state.notes[0].excluded = true;
    },
    f => {
      f.state.notes[0].spaceId = 'outside';
    },
    f => {
      f.state.notes[0].rawMarkdown += '新版本';
    },
    f => {
      f.state.evidence[0].noteVersionId = 'missing-version';
    },
    f => {
      f.state.evidence[0].noteId = 'missing-note';
    },
    f => {
      f.state.evidence[0].status = 'invalid';
    },
    f => {
      f.state.evidence[0].status = 'stale';
    },
    f => {
      f.state.evidence[0].status = 'insufficient';
    },
    f => {
      f.state.evidence[0].quoteText = '不匹配来源摘要的引文';
    },
    f => {
      f.state.records[0] = seal({
        ...f.state.records[0],
        sources: f.state.records[0].sources.map(source => ({
          ...source,
          quoteText: '不匹配原始版本的引用',
          start: 0,
          end: '不匹配原始版本的引用'.length,
          quoteHash: calculateContentHash('不匹配原始版本的引用')
        }))
      });
    },
    f => {
      f.state.evidence.shift();
    },
    f => {
      f.state.records[0].provenanceHash = 'f'.repeat(64);
    }
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(f.readKnowledge(), hidden);
    const rows = await f.listKnowledge();
    assert.deepEqual(
      rows.map(value => value.knowledgeId),
      [f.state.items[1].id]
    );
  }
});

test('MCP 独立知识授权：历史 origin 空间不代替当前授权，合法迁移后按当前来源空间读取', async () => {
  const f = await fixture();
  f.space.id = 'space-2';
  for (const note of f.state.notes) note.spaceId = 'space-2';
  assert.equal((await f.readKnowledge()).knowledgeId, f.state.items[0].id);
  assert.equal((await f.listKnowledge()).length, 2);
  f.space.userId = 'other-owner';
  await assert.rejects(f.readKnowledge(), hidden);
  assert.deepEqual(await f.listKnowledge(), []);
});

test('MCP 独立知识授权：全部审核状态明确返回，删除知识从读取与清单隐藏', async () => {
  const f = await fixture({ count: 5 });
  ['candidate', 'confirmed', 'needsRevision', 'archived', 'confirmed'].forEach((status, index) => {
    f.state.items[index].reviewStatus = status;
  });
  f.state.items[4].deletedAt = '2026-10-09T00:00:00.000Z';
  const rows = await f.listKnowledge();
  assert.deepEqual(
    rows.map(value => value.reviewStatus).sort(),
    ['candidate', 'confirmed', 'needsRevision', 'archived'].sort()
  );
  await assert.rejects(f.readKnowledge(f.state.items[4].id), hidden);
});

test('MCP 独立知识授权：知识、证据和来源在读取期间变化时不返回混合快照', async () => {
  for (const mutateOnRead of [1, 2])
    for (const which of ['item', 'evidence', 'privacy', 'identity']) {
      const f = await fixture();
      let reads = 0;
      const original = f.args.access.verifyRead;
      f.args.access.verifyRead = async args => {
        const result = await original(args);
        if (++reads === mutateOnRead) {
          if (which === 'item') f.state.items[0].title = '变化后的标题';
          if (which === 'evidence') f.state.evidence.push({ ...f.state.evidence[0], id: 'added-evidence' });
          if (which === 'privacy') f.state.notes[0].aiVisibility = 'private';
          if (which === 'identity') f.state.identity.datasetEpoch = 'epoch-2';
        }
        return result;
      };
      await assert.rejects(f.readKnowledge(), hidden);
    }
});

test('MCP 独立知识授权：清单最终批量复核包含非本页来源，未知来源也复核数据集身份', async () => {
  const f = await fixture();
  f.state.beforeFinal = () => {
    f.state.notes[0].aiVisibility = 'private';
  };
  await assert.rejects(f.listKnowledge(), hidden);

  const manual = await fixture({ count: 1 });
  manual.state.items[0].sourceMode = 'manual';
  manual.state.records = [];
  manual.state.evidence = [];
  const old = manual.repositories.knowledgeItemRepository.findById;
  let count = 0;
  manual.repositories.knowledgeItemRepository.findById = value => {
    const result = old(value);
    if (++count === 2) manual.state.identity.datasetEpoch = 'next';
    return result;
  };
  await assert.rejects(manual.readKnowledge(), hidden);
});

test('MCP 独立知识授权：隐藏知识变化不影响快照，新增可见知识在下次调用出现', async () => {
  const f = await fixture();
  f.state.notes[1].aiVisibility = 'private';
  f.state.beforeFinal = () => {
    f.state.items[1].title = '隐藏知识标题变化';
    f.state.items[1].userExplanation = '隐藏知识解释变化';
    f.state.items.push({ ...f.state.items[0], id: 'new-manual', sourceMode: 'manual' });
    f.state.beforeFinal = null;
  };
  const rows = await f.listKnowledge();
  assert.deepEqual(
    rows.map(value => value.knowledgeId),
    [f.state.items[0].id]
  );
  assert.doesNotThrow(() => f.service.assertCurrent(rows));
  assert.equal((await f.listKnowledge()).length, 2);
});

test('MCP 同步终检：四类原始输出都能验证，复制或篡改 DTO 拒绝', async () => {
  const f = await fixture();
  for (const result of [await f.readKnowledge(), await f.listKnowledge(), await f.get(), await f.receipt(false)]) {
    assert.equal(f.service.assertCurrent(result), undefined);
    assert.throws(() => f.service.assertCurrent(copy(result)), hidden);
  }
  const result = await f.readKnowledge();
  result.userExplanation = '伪造输出';
  assert.throws(() => f.service.assertCurrent(result), hidden);
});

test('MCP 同步终检：最后异步来源检查期间新增私密来源或软删除，也绝不发出旧正文', async () => {
  for (const which of ['evidence', 'deletedAt', 'text']) {
    const f = await fixture();
    f.state.notes[1].aiVisibility = 'private';
    f.state.beforeFinal = () => {
      if (which === 'evidence')
        f.state.evidence.push({
          ...f.state.evidence[1],
          id: 'late-private-source',
          knowledgeItemId: f.state.items[0].id
        });
      if (which === 'deletedAt') f.state.items[0].deletedAt = '2026-10-09T00:00:00.000Z';
      if (which === 'text') f.state.items[0].canonicalStatement = '最后一次 await 期间编辑';
    };
    const result = await f.readKnowledge();
    assert.throws(() => f.service.assertCurrent(result), hidden);
  }
});

test('MCP 同步终检：返回后切私密、改数据集、撤权、过期或owner变化全部拒绝', async () => {
  const mutations = [
    f => {
      f.state.notes[0].aiVisibility = 'private';
    },
    f => {
      f.state.identity.datasetEpoch = 'next';
    },
    f => {
      f.state.policy.revokedAt = '2026-10-09T00:00:00.000Z';
    },
    f => {
      f.state.policy.revision++;
    },
    f => {
      f.state.policy.excludedNoteIds.push('note-0');
    },
    f => {
      f.state.policy.scope = { kind: 'fixed', noteIds: ['note-1'] };
    },
    f => {
      f.state.grant.expiresAt = '2000-01-01T00:00:00.000Z';
    },
    f => {
      f.space.userId = 'other-owner';
    }
  ];
  for (const mutate of mutations) {
    const f = await fixture(),
      result = await f.readKnowledge();
    mutate(f);
    assert.throws(() => f.service.assertCurrent(result), hidden);
  }
});

test('MCP 同步终检：笔记未动但父目录移出授权树也撤销读取', async () => {
  const f = await fixture();
  f.state.policy.scope = { kind: 'folder', folderId: 'root' };
  f.state.folders.push(
    { id: 'root', spaceId: f.space.id, parentId: null },
    { id: 'middle', spaceId: f.space.id, parentId: 'root' },
    { id: 'leaf', spaceId: f.space.id, parentId: 'middle' }
  );
  f.state.notes[0].folderId = 'leaf';
  const result = await f.readKnowledge();
  assert.doesNotThrow(() => f.service.assertCurrent(result));
  f.state.folders[1].parentId = null;
  assert.throws(() => f.service.assertCurrent(result), hidden);
});

test('MCP 同步终检：异步仓库或异步identity不能伪装同步安全检查', async () => {
  for (const which of ['repository', 'identity']) {
    const f = await fixture(),
      result = await f.readKnowledge();
    if (which === 'repository') {
      const old = f.repositories.knowledgeItemRepository.findById;
      f.repositories.knowledgeItemRepository.findById = async value => old(value);
    } else f.accessStore.peekIdentity = async () => f.state.identity;
    assert.throws(() => f.service.assertCurrent(result), hidden);
  }
});

test('MCP 同步终检：无来源知识也受最终dataset边界保护；清单新增项留待下次快照', async () => {
  const f = await fixture({ count: 1 });
  f.state.items[0].sourceMode = 'manual';
  f.state.evidence = [];
  f.state.records = [];
  const result = await f.readKnowledge();
  assert.doesNotThrow(() => f.service.assertCurrent(result));
  f.state.identity.datasetEpoch = 'next';
  assert.throws(() => f.service.assertCurrent(result), hidden);

  const listed = await fixture(),
    rows = await listed.listKnowledge();
  listed.state.items.push({ ...listed.state.items[0], id: 'new-item' });
  assert.doesNotThrow(() => listed.service.assertCurrent(rows));
  assert.equal((await listed.listKnowledge()).length, rows.length + 1);
});

test('MCP 目录同步终检：授权notes与策略快照不进入输出，可见信息变化均拒绝', async () => {
  for (const which of ['title', 'private', 'new', 'policy', 'epoch']) {
    const f = await fixture();
    const guard = f.service.captureNavigationGuard({ grantId: f.args.grantId });
    assert.equal(typeof guard, 'function');
    assert.equal(guard(), undefined);
    if (which === 'title') f.state.notes[0].title = '新标题';
    if (which === 'private') f.state.notes[0].aiVisibility = 'private';
    if (which === 'new') f.state.notes.push({ ...f.state.notes[0], id: 'new-note' });
    if (which === 'policy') f.state.policy.excludedNoteIds.push('note-0');
    if (which === 'epoch') f.state.identity.datasetEpoch = 'next';
    assert.throws(() => guard(), hidden);
  }
});

test('MCP 目录同步终检：隐藏笔记变化和无关目录变化不改变授权快照', async () => {
  for (const hiddenBy of ['private', 'excluded', 'fixed']) {
    const f = await fixture();
    if (hiddenBy === 'private') f.state.notes[1].aiVisibility = 'private';
    if (hiddenBy === 'excluded') f.state.policy.excludedNoteIds.push('note-1');
    if (hiddenBy === 'fixed') f.state.policy.scope = { kind: 'fixed', noteIds: ['note-0'] };
    const guard = f.service.captureNavigationGuard({ grantId: f.args.grantId });
    f.state.notes[1].title = '隐藏标题变化';
    f.state.notes[1].rawMarkdown = '隐藏正文变化';
    f.state.folders.push({ id: 'unrelated-folder', spaceId: f.space.id, parentId: null });
    assert.doesNotThrow(guard);
  }
});

test('MCP 目录同步终检：授权笔记的父目录移动改变可见范围，必须拒绝', async () => {
  const f = await fixture();
  f.state.policy.scope = { kind: 'folder', folderId: 'root' };
  f.state.folders.push(
    { id: 'root', spaceId: f.space.id, parentId: null },
    { id: 'leaf', spaceId: f.space.id, parentId: 'root' }
  );
  f.state.notes[0].folderId = 'leaf';
  const guard = f.service.captureNavigationGuard({ grantId: f.args.grantId });
  assert.doesNotThrow(guard);
  f.state.folders[1].parentId = null;
  assert.throws(guard, hidden);
});
