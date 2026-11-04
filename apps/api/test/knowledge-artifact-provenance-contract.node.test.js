import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AppError } from '../src/errors/app-error.js';
import {
  createLegacyKnowledgeArtifactProvenance,
  hashKnowledgeArtifactProvenance,
  knowledgeArtifactProvenanceId,
  resolveKnowledgeArtifactProvenanceSource,
  validateKnowledgeArtifactProvenance
} from '../src/modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
function seal(record) {
  const { provenanceHash, ...content } = record;
  return { ...content, provenanceHash: hashKnowledgeArtifactProvenance(content) };
}
function fixture() {
  const content = '前言\n  来源😀摘录 \n结尾';
  const quoteText = '  来源😀摘录 \n';
  const start = content.indexOf(quoteText),
    end = start + quoteText.length;
  const source = {
    evidenceId: 'evidence-1',
    sourceId: 'source-1',
    noteId: 'note-1',
    originNoteVersionId: 'version-origin',
    contentHash: sha(content),
    start,
    end,
    quoteText,
    quoteHash: sha(quoteText),
    annotationRevisions: [{ annotationId: 'annotation-1', revision: 2 }]
  };
  const record = seal({
    id: knowledgeArtifactProvenanceId('item-1'),
    schemaVersion: 1,
    state: 'recorded',
    artifactKind: 'knowledgeItem',
    artifactId: 'item-1',
    executionMode: 'mock',
    provider: 'mock',
    modelId: 'deepseek-flash',
    promptVersion: 'original-prompt-v1',
    resultSchemaVersion: 'knowledge-extraction-v1',
    origin: {
      jobId: 'job-1',
      requestId: 'request-1',
      scopeId: 'scope-1',
      spaceId: 'historical-space',
      receiptHash: sha('receipt')
    },
    inputHash: sha('original-input'),
    outputHash: sha('original-output'),
    committedAt: '2026-10-02T00:00:00.000Z',
    sources: [source]
  });
  return {
    record,
    source,
    evidence: {
      id: source.evidenceId,
      knowledgeItemId: record.artifactId,
      noteId: source.noteId,
      sourceType: 'noteVersion',
      noteVersionId: source.originNoteVersionId,
      quoteText: quoteText.trim(),
      status: 'valid',
      applicabilityStatus: 'active'
    },
    noteVersion: { id: source.originNoteVersionId, noteId: source.noteId, contentHash: sha(content), content },
    note: { id: source.noteId, spaceId: 'migrated-space', rawMarkdown: content, deleted: false },
    knowledgeItem: { id: record.artifactId, sourceMode: 'manual', reviewStatus: 'confirmed', deletedAt: null }
  };
}
const rejects = (run, suffix = 'INVALID') =>
  assert.throws(
    run,
    error =>
      error instanceof AppError && error.statusCode === 422 && error.code === `KNOWLEDGE_ARTIFACT_PROVENANCE_${suffix}`
  );
const validateChanged = change => {
  const { record } = fixture();
  change(record);
  return validateKnowledgeArtifactProvenance(seal(record));
};

test('固定 ID、domain 与 canonical JSON 测试向量，数组保持顺序', () => {
  assert.equal(
    knowledgeArtifactProvenanceId('item-1'),
    'provenance-8ab59477127237654ed6410d4d9d62c2e8a57e74040daa8021f0b463d7be1ff5'
  );
  const expected = 'baa8353a8363e1281c13807c3f8fb6d4ba3654876fa7b13dcce87f7bd4e85900';
  assert.equal(hashKnowledgeArtifactProvenance({ z: [{ b: 2, a: 1 }, '中'], a: 1 }), expected);
  assert.equal(hashKnowledgeArtifactProvenance({ a: 1, z: [{ a: 1, b: 2 }, '中'] }), expected);
  assert.notEqual(hashKnowledgeArtifactProvenance({ a: 1, z: ['中', { a: 1, b: 2 }] }), expected);
});

test('recorded 保留合法旧模型标识、精确空白，校验返回独立副本', () => {
  const { record } = fixture(),
    copy = validateKnowledgeArtifactProvenance(record);
  assert.deepEqual(copy, record);
  copy.sources[0].annotationRevisions[0].revision = 3;
  assert.equal(record.sources[0].annotationRevisions[0].revision, 2);
  assert.equal(copy.provider, 'mock');
  assert.equal(copy.modelId, 'deepseek-flash');
});

test('legacy 是严格联合且不虚构生成来源', () => {
  const record = createLegacyKnowledgeArtifactProvenance('item-legacy');
  assert.deepEqual(validateKnowledgeArtifactProvenance(record), record);
  assert.deepEqual(Object.keys(record).sort(), [
    'artifactId',
    'artifactKind',
    'id',
    'provenanceHash',
    'reason',
    'schemaVersion',
    'state'
  ]);
  rejects(() => validateKnowledgeArtifactProvenance(seal({ ...record, provider: 'mock' })));
  rejects(() => validateKnowledgeArtifactProvenance(seal({ ...record, reason: 'unknown' })));
  rejects(() =>
    validateChanged(value => {
      value.state = 'future';
    })
  );
});

test('每层白名单拒绝额外私有字段与缺失字段', () => {
  for (const extra of [
    'request',
    'result',
    'task',
    'grant',
    'attempt',
    'lease',
    'manifest',
    'conversation',
    'budget',
    'credentialRef'
  ]) {
    rejects(() =>
      validateChanged(record => {
        record[extra] = 'private';
      })
    );
  }
  const cases = [
    record => {
      record.origin.ownerId = 'private-owner';
    },
    record => {
      record.sources[0].markdown = 'unreferenced';
    },
    record => {
      record.sources[0].annotationRevisions[0].quoteText = 'private';
    },
    record => {
      delete record.modelId;
    },
    record => {
      delete record.origin.receiptHash;
    },
    record => {
      delete record.sources[0].quoteHash;
    },
    record => {
      delete record.sources[0].annotationRevisions[0].revision;
    }
  ];
  for (const change of cases) rejects(() => validateChanged(change));
});

test('原型、不可枚举字段、symbol、数组额外字段及稀疏值不能逃过 JSON 白名单', () => {
  for (const modify of [
    record => {
      Object.defineProperty(record, 'secret', { value: 'hidden' });
    },
    record => {
      record[Symbol('secret')] = 'hidden';
    },
    record => {
      Object.setPrototypeOf(record.origin, { secret: 'hidden' });
    },
    record => {
      record.sources.extra = 'hidden';
    },
    record => {
      record.sources = Array(1);
    }
  ]) {
    const { record } = fixture();
    modify(record);
    rejects(() => validateKnowledgeArtifactProvenance(record));
  }
});

test('完整 JSON 先按 UTF-8 预检 1 MiB，不先深入字段校验且不泄露摘录', () => {
  const { record } = fixture();
  record.secret = '秘'.repeat(400000);
  rejects(() => validateKnowledgeArtifactProvenance(record), 'TOO_LARGE');
  try {
    validateKnowledgeArtifactProvenance(record);
  } catch (error) {
    assert.ok(!error.message.includes('秘'));
    assert.ok(!error.message.includes(record.sources[0].quoteText));
  }
  const circular = {};
  circular.self = circular;
  rejects(() => validateKnowledgeArtifactProvenance(circular));
  rejects(() => validateKnowledgeArtifactProvenance({ value: 1n }));
});

test('所有身份、hash、时间与联合常量均严格校验', () => {
  for (const bad of ['', ' x', 'x ', 'a\n', 'a\u007f', 'a\u0085', 'x'.repeat(201), '\ud800']) {
    rejects(() => knowledgeArtifactProvenanceId(bad));
    rejects(() =>
      validateChanged(record => {
        record.origin.scopeId = bad;
      })
    );
    rejects(() =>
      validateChanged(record => {
        record.sources[0].noteId = bad;
      })
    );
  }
  const cases = [
    record => {
      record.schemaVersion = 2;
    },
    record => {
      record.artifactKind = 'question';
    },
    record => {
      record.id = 'provenance-wrong';
    },
    record => {
      record.provider = 'deepseek';
    },
    record => {
      record.executionMode = 'live';
    },
    record => {
      record.resultSchemaVersion = 1;
    },
    record => {
      record.inputHash = record.inputHash.toUpperCase();
    },
    record => {
      record.outputHash = 'a'.repeat(63);
    },
    record => {
      record.origin.receiptHash = 'g'.repeat(64);
    },
    record => {
      record.sources[0].contentHash = 'g'.repeat(64);
    },
    record => {
      record.committedAt = 'Oct 2 2026';
    },
    record => {
      record.committedAt = '2026-13-01T00:00:00Z';
    }
  ];
  for (const change of cases) rejects(() => validateChanged(change));
});

test('拒绝修改后的 provenanceHash 与 quoteHash', () => {
  const { record } = fixture();
  record.modelId = 'edited-model';
  rejects(() => validateKnowledgeArtifactProvenance(record), 'HASH_MISMATCH');
  rejects(() =>
    validateChanged(value => {
      value.sources[0].quoteHash = sha('edited-quote');
    })
  );
});

test('UTF-16 范围必须是安全整数且等于原摘录长度', () => {
  for (const [start, end] of [
    [-1, 5],
    [1, 1],
    [2, 1],
    [0.5, 5],
    [0, Number.MAX_SAFE_INTEGER + 1],
    [0, 8001]
  ]) {
    rejects(() =>
      validateChanged(record => {
        Object.assign(record.sources[0], { start, end });
      })
    );
  }
  for (const quoteText of ['\ud800', '\udc00', 'a\ud800b', 'x'.repeat(8001)]) {
    rejects(() =>
      validateChanged(record => {
        Object.assign(record.sources[0], { start: 0, end: quoteText.length, quoteText, quoteHash: sha(quoteText) });
      })
    );
  }
  const result = validateChanged(record => {
    const quoteText = '😀'.repeat(4000);
    Object.assign(record.sources[0], { start: 0, end: 8000, quoteText, quoteHash: sha(quoteText) });
  });
  assert.equal(result.sources[0].quoteText.length, 8000);
});

test('sources 限 1–8 个且按原顺序保留，同 sourceId 的不同片段合法', () => {
  rejects(() =>
    validateChanged(record => {
      record.sources = [];
    })
  );
  rejects(() =>
    validateChanged(record => {
      record.sources = Array.from({ length: 9 }, () => structuredClone(record.sources[0]));
    })
  );
  rejects(() =>
    validateChanged(record => {
      record.sources.push({ ...record.sources[0], evidenceId: 'evidence-other' });
    })
  );
  rejects(() =>
    validateChanged(record => {
      record.sources.push({ ...record.sources[0], sourceId: 'other-source' });
    })
  );
  const result = validateChanged(record => {
    const next = {
      ...record.sources[0],
      evidenceId: 'evidence-2',
      start: 100,
      end: 100 + record.sources[0].quoteText.length
    };
    record.sources.push(next);
  });
  assert.deepEqual(
    result.sources.map(source => source.evidenceId),
    ['evidence-1', 'evidence-2']
  );
});

test('annotation 按 ID 去重且 revision 只能是正安全整数', () => {
  for (const revision of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
    rejects(() =>
      validateChanged(record => {
        record.sources[0].annotationRevisions[0].revision = revision;
      })
    );
  }
  rejects(() =>
    validateChanged(record => {
      record.sources[0].annotationRevisions.push({ annotationId: 'annotation-1', revision: 3 });
    })
  );
});

test('Evidence alias 返回当前版本 ID，原始身份、全部 hash 和摘录完全不变', () => {
  const input = fixture(),
    original = structuredClone(input.record);
  assert.deepEqual(resolveKnowledgeArtifactProvenanceSource(input), {
    originalVersionId: 'version-origin',
    resolvedVersionId: 'version-origin',
    aliasUsed: false,
    sourceState: 'available'
  });
  input.noteVersion.id = input.evidence.noteVersionId = 'version-synchronized';
  assert.deepEqual(resolveKnowledgeArtifactProvenanceSource(input), {
    originalVersionId: 'version-origin',
    resolvedVersionId: 'version-synchronized',
    aliasUsed: true,
    sourceState: 'available'
  });
  assert.deepEqual(input.record, original);
});

test('resolver 逐项拒绝不存在、跨产物、跨笔记、假 hash、错误 exact slice 或 trim quote', () => {
  const changes = [
    input => {
      delete input.evidence;
    },
    input => {
      delete input.noteVersion;
    },
    input => {
      delete input.note;
    },
    input => {
      delete input.knowledgeItem;
    },
    input => {
      input.evidence.knowledgeItemId = 'other-item';
    },
    input => {
      input.knowledgeItem.id = 'other-item';
    },
    input => {
      input.evidence.noteId = 'other-note';
    },
    input => {
      input.note.id = 'other-note';
    },
    input => {
      input.noteVersion.noteId = 'other-note';
    },
    input => {
      input.evidence.sourceType = 'manual';
    },
    input => {
      input.noteVersion.id = 'unrelated-version';
    },
    input => {
      input.noteVersion.contentHash = sha('same-id-other-hash');
    },
    input => {
      input.noteVersion.content += 'tampered-outside-quote';
    },
    input => {
      input.evidence.quoteText = input.source.quoteText;
    },
    input => {
      input.source = { ...input.source, evidenceId: 'foreign-evidence' };
    },
    input => {
      input.source = { ...input.source, originNoteVersionId: 'foreign-origin' };
    },
    input => {
      const source = { ...input.source, start: input.source.start + 1, end: input.source.end + 1 };
      input.record = seal({ ...input.record, sources: [source] });
      input.source = source;
    }
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    rejects(() => resolveKnowledgeArtifactProvenanceSource(input), 'SOURCE_MISMATCH');
  }
});

test('当前笔记变更、软删除、归档与撤回只改变派生 sourceState', () => {
  for (const [change, state] of [
    [
      input => {
        input.note.rawMarkdown += 'new version';
      },
      'stale'
    ],
    [
      input => {
        input.evidence.status = 'stale';
      },
      'stale'
    ],
    [
      input => {
        input.note.deleted = true;
      },
      'unavailable'
    ],
    [
      input => {
        input.knowledgeItem.deletedAt = '2026-10-02T01:00:00Z';
      },
      'unavailable'
    ],
    [
      input => {
        input.knowledgeItem.reviewStatus = 'archived';
      },
      'unavailable'
    ],
    [
      input => {
        input.evidence.applicabilityStatus = 'withdrawn';
      },
      'unavailable'
    ],
    [
      input => {
        input.evidence.applicabilityStatus = 'needsReview';
      },
      'unavailable'
    ],
    [
      input => {
        input.evidence.status = 'invalid';
      },
      'unavailable'
    ]
  ]) {
    const input = fixture(),
      before = structuredClone(input.record);
    change(input);
    assert.equal(resolveKnowledgeArtifactProvenanceSource(input).sourceState, state);
    assert.deepEqual(input.record, before);
  }
});
