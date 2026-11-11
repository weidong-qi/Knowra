import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildUserPayload,
  checkResult,
  headingsOf,
  locateQuote,
  summarize,
  titleFlags
} from '../experiments/knowledge-extraction-ab/lib.mjs';
import { buildPromptV2 } from '../experiments/knowledge-extraction-ab/prompt-v2.mjs';
import { main, parseArgs, resolveApiKey } from '../experiments/knowledge-extraction-ab/run.mjs';

const markdown = '## 2.3 线性代数\n\n矩阵和向量如何相乘？矩阵乘向量的结果是一个向量。';
const sources = [{ sourceId: 's1', markdown }];
const quote = '矩阵乘向量的结果是一个向量。';
const start = markdown.indexOf(quote);

test('标题标记能识别问题句、空泛后缀、照抄小标题和复用', () => {
  assert.deepEqual(titleFlags('矩阵和向量如何相乘？'), ['问题句']);
  assert.deepEqual(titleFlags('什么是链式法则'), ['问题句']);
  assert.deepEqual(titleFlags('深度学习的概念'), ['空泛后缀']);
  assert.deepEqual(titleFlags('线性代数', { headings: headingsOf(markdown) }), ['照抄小标题']);
  assert.deepEqual(titleFlags('矩阵-向量乘法', { existingTitles: ['矩阵-向量乘法'] }), ['复用已有']);
  assert.deepEqual(titleFlags('矩阵 向量乘法', { existingTitles: ['矩阵-向量乘法'] }), ['近似已有但未逐字复用']);
  assert.deepEqual(titleFlags('矩阵乘法不满足交换律'), []);
});

test('引文按线上规则匹配：正确偏移直接采用，错误偏移可唯一 quote 重定位', () => {
  const content = JSON.stringify({
    contractVersion: 1,
    requestId: 'r',
    candidates: [
      {
        title: '矩阵-向量乘法',
        canonicalStatement: '矩阵乘向量得到向量。',
        knowledgeType: 'fact',
        citations: [{ sourceId: 's1', start, end: start + quote.length, quote }]
      },
      {
        title: '矩阵-向量乘法的结果',
        canonicalStatement: '矩阵乘向量得到向量。',
        knowledgeType: 'fact',
        citations: [{ sourceId: 's1', start: 0, end: quote.length, quote }]
      }
    ]
  });
  const check = checkResult({ content, requestId: 'r', sources });
  assert.equal(check.ok, true);
  assert.equal(check.candidates[0].citationsExact, true);
  assert.equal(check.candidates[0].citationsRelocated, false);
  assert.equal(check.candidates[1].citationsExact, false);
  assert.equal(check.candidates[1].citationsLocated, true);
  assert.equal(check.candidates[1].citationsRelocated, true);
  assert.deepEqual(check.candidates[1].problems, []);
  assert.equal(checkResult({ content: '不是 JSON', requestId: 'r', sources }).batchError, 'JSON 解析失败');

  // 有效标题的统计不应被单个无效引文抹掉；整批却必须拒绝。
  const bad = JSON.stringify({
    contractVersion: 1,
    requestId: 'r',
    candidates: [
      {
        title: '张量的定义',
        canonicalStatement: '一条原文没有的内容',
        knowledgeType: 'fact',
        citations: [{ sourceId: 's1', start: 0, end: 4, quote: '不存在的原文' }]
      }
    ]
  });
  const invalid = checkResult({ content: bad, requestId: 'r', sources });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.candidates[0].citationsLocated, false);
  assert.equal(summarize([{ note: 'n.md', headings: [], existingTitles: [], check: invalid }]).fillerTitles, 1);
});

test('引文唯一性、安全范围和 UTF-16 边界：错误时不接受', () => {
  const ambiguous = '两个矩阵做乘法；两个矩阵做乘法';
  const q = '两个矩阵做乘法';
  assert.equal(locateQuote(ambiguous, { sourceId: 'x', start: 0, end: q.length, quote: q }).status, 'exact');
  assert.equal(locateQuote(ambiguous, { sourceId: 'x', start: 3, end: 3 + q.length, quote: q }).status, 'invalid');
  assert.equal(locateQuote(markdown, { sourceId: 'x', start: 0, end: 4, quote: '不存在' }).status, 'invalid');
  assert.equal(locateQuote('A😀B', { sourceId: 'x', start: 0, end: 1, quote: '\ud83d' }).status, 'invalid');
  assert.equal(locateQuote('A😀B', { sourceId: 'x', start: 0, end: 1, quote: '😀' }).status, 'relocated');
  assert.equal(locateQuote(markdown, { sourceId: 'x', start: 0, end: 4, quote: '' }).status, 'invalid');
  const repeated = checkResult({
    content: JSON.stringify({
      contractVersion: 1,
      requestId: 'r',
      candidates: [
        {
          title: '重复引用',
          canonicalStatement: '原文',
          knowledgeType: 'fact',
          citations: [
            { sourceId: 's1', start: 0, end: quote.length, quote },
            { sourceId: 's1', start, end: start + quote.length, quote }
          ]
        }
      ]
    }),
    requestId: 'r',
    sources
  });
  assert.equal(repeated.ok, false);
  assert.match(repeated.candidates[0].problems.join(' '), /重复引用/);
});

test('实验定位算法和线上 anchorQuote 的行为一致（合成数据）', async () => {
  const { anchorQuote } =
    await import('../../apps/api/src/modules/knowledge/application/knowledge-extraction-contract.js');
  const cases = [
    ['A😀B', { sourceId: 'x', start: 1, end: 3, quote: '😀' }],
    ['A😀B', { sourceId: 'x', start: 0, end: 2, quote: '😀' }],
    ['AB AB', { sourceId: 'x', start: 0, end: 2, quote: 'AB' }],
    ['AB AB', { sourceId: 'x', start: 1, end: 3, quote: 'AB' }],
    ['AB', { sourceId: 'x', start: 0, end: 2, quote: '不存在' }],
    ['A😀B', { sourceId: 'x', start: 0, end: 1, quote: '\ud83d' }]
  ];
  for (const [markdownText, citation] of cases) {
    const local = locateQuote(markdownText, citation);
    if (local.status === 'invalid') assert.throws(() => anchorQuote(markdownText, citation));
    else assert.deepEqual(anchorQuote(markdownText, citation), { start: local.start, end: local.end });
  }
});

test('只有 v2 请求携带已有知识点标题，v1 外发结构与线上一致', () => {
  assert.deepEqual(
    Object.keys(buildUserPayload({ variant: 'v1', requestId: 'r', sources, existingTitles: ['x'] })).sort(),
    ['contractVersion', 'requestId', 'sources']
  );
  assert.deepEqual(
    buildUserPayload({ variant: 'v2', requestId: 'r', sources, existingTitles: ['x'] }).existingKnowledgeTitles,
    ['x']
  );
  assert.match(buildPromptV2({ type: 'object' }), /不能是问题句/);
});

test('--max-tokens 限定真实实验的最大模型输出，不接受非法预算', () => {
  const args = parseArgs(['--notes', 'synthetic', '--max-tokens', '2048']);
  assert.equal(args.maxTokens, 2048);
  assert.equal(parseArgs(['--notes', 'synthetic']).maxTokens, 8192);
  for (const value of ['0', '-1', 'abc', '2048.5', '99999']) {
    assert.throws(() => parseArgs(['--notes', 'synthetic', '--max-tokens', value]), /--max-tokens/);
  }
});

test('API key 只从环境变量解析，多个候选变量时要求显式指定', () => {
  assert.deepEqual(resolveApiKey({ DEEPSEEK_API_KEY: 'k' }), { name: 'DEEPSEEK_API_KEY', value: 'k' });
  assert.throws(() => resolveApiKey({ DEEPSEEK_API_KEY: 'a', MY_DEEPSEEK_TOKEN: 'b' }), /--key-env/);
  assert.equal(resolveApiKey({ OTHER: 'x' }).value, undefined);
});

test('端到端：v2 逐篇累积已有标题，报告与汇总生成且不泄露 key', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'knowledge-ab-'));
  const notesDir = path.join(dir, 'notes');
  await import('node:fs/promises').then(fs => fs.mkdir(notesDir));
  await writeFile(path.join(notesDir, '1.md'), markdown);
  await writeFile(path.join(notesDir, '2.md'), markdown);
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const user = JSON.parse(body.messages[1].content);
    calls.push(user);
    const title = user.existingKnowledgeTitles === undefined ? '矩阵和向量如何相乘？' : '矩阵-向量乘法';
    const s = user.sources[0];
    const content = JSON.stringify({
      contractVersion: 1,
      requestId: user.requestId,
      candidates: [
        {
          title,
          canonicalStatement: '矩阵乘向量得到向量。',
          knowledgeType: 'fact',
          citations: [{ sourceId: s.sourceId, start, end: start + quote.length, quote }]
        }
      ]
    });
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    );
  };
  const out = path.join(dir, 'out');
  const { summaries } = await main(['--notes', notesDir, '--out', out], {
    env: { DEEPSEEK_API_KEY: 'secret-key-value' },
    fetchImpl,
    log: () => {},
    loadV1: async () => ({ v1Prompt: 'v1 prompt', schema: { type: 'object' } })
  });
  assert.equal(summaries.v1.questionTitles, 2);
  assert.equal(summaries.v1.crossNoteDuplicates, 1);
  assert.equal(summaries.v2.questionTitles, 0);
  assert.equal(summaries.v2.reusedExisting, 1);
  assert.deepEqual(calls[3].existingKnowledgeTitles, ['矩阵-向量乘法']);
  const report = await readFile(path.join(out, 'report.md'), 'utf8');
  assert.match(report, /问题句标题/);
  assert.equal(report.includes('secret-key-value'), false);
  assert.equal((await readFile(path.join(out, 'raw.json'), 'utf8')).includes('secret-key-value'), false);
});

test('端到端：模型偏移全部错但 quote 唯一时，第二篇仍收到已有标题并复用', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'knowledge-overlap-'));
  const notesDir = path.join(dir, 'notes');
  await import('node:fs/promises').then(fs => fs.mkdir(notesDir));
  await writeFile(path.join(notesDir, '01.md'), '## 矩阵乘法\n矩阵乘法用于计算线性变换。');
  await writeFile(path.join(notesDir, '02.md'), '## 神经网络\n矩阵乘法也用于计算神经网络的线性层。');
  const seen = [];
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(JSON.parse(init.body).messages[1].content);
    seen.push(request);
    const text = request.sources[0].markdown;
    const quote = text.includes('线性变换') ? '矩阵乘法用于计算线性变换。' : '矩阵乘法也用于计算神经网络的线性层。';
    const body = {
      contractVersion: 1,
      requestId: request.requestId,
      candidates: [
        {
          title: '矩阵乘法',
          canonicalStatement: quote,
          knowledgeType: 'fact',
          citations: [{ sourceId: request.sources[0].sourceId, start: 0, end: quote.length, quote }]
        }
      ]
    };
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(body) } }],
        usage: { prompt_tokens: 15, completion_tokens: 10 }
      })
    );
  };
  const out = path.join(dir, 'out');
  const { summaries } = await main(['--notes', notesDir, '--out', out], {
    env: { DEEPSEEK_API_KEY: 'synthetic-key' },
    fetchImpl,
    log: () => {},
    loadV1: async () => ({ v1Prompt: 'v1', schema: { type: 'object' } })
  });
  assert.equal(summaries.v2.relocatedCitationCandidates, 2);
  assert.equal(summaries.v2.locatedCitationCandidates, 2);
  assert.equal(summaries.v2.batchesRejectedOnline, 0);
  assert.deepEqual(seen[3].existingKnowledgeTitles, ['矩阵乘法']);
  assert.equal(summaries.v2.reusedExisting, 1);
  assert.equal(summaries.v2.notesWithExistingTitles, 1);
  const report = await readFile(path.join(out, 'report.md'), 'utf8');
  assert.match(report, /整批校验成功后模拟采用/);
});

test('端到端：引文真正无效导致整批失败时，不把标题加入下一篇', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'knowledge-reject-'));
  const notesDir = path.join(dir, 'notes');
  await import('node:fs/promises').then(fs => fs.mkdir(notesDir));
  await writeFile(path.join(notesDir, '01.md'), '## 梯度\n梯度描述局部变化方向。');
  await writeFile(path.join(notesDir, '02.md'), '## 梯度下降\n使用梯度决定更新方向。');
  const seen = [];
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(JSON.parse(init.body).messages[1].content);
    seen.push(request);
    const quoted = request.sources[0].markdown.includes('局部') ? '来源并未包含这句话' : '使用梯度决定更新方向。';
    const body = {
      contractVersion: 1,
      requestId: request.requestId,
      candidates: [
        {
          title: '梯度',
          canonicalStatement: quoted,
          knowledgeType: 'fact',
          citations: [{ sourceId: request.sources[0].sourceId, start: 0, end: quoted.length, quote: quoted }]
        }
      ]
    };
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(body) } }] })
    );
  };
  const { summaries } = await main(['--notes', notesDir, '--out', path.join(dir, 'out')], {
    env: { DEEPSEEK_API_KEY: 'synthetic-key' },
    fetchImpl,
    log: () => {},
    loadV1: async () => ({ v1Prompt: 'v1', schema: { type: 'object' } })
  });
  assert.deepEqual(seen[3].existingKnowledgeTitles, []);
  assert.equal(summaries.v2.batchesRejectedOnline, 1);
  assert.equal(summaries.v2.reusedExisting, 0);
});

test('单个长笔记按“章.节”切分，同一节的小节留在一篇里', async () => {
  const { splitBySection } = await import('../experiments/knowledge-extraction-ab/lib.mjs');
  const parts = splitBySection(
    '前言\n# 1.0 引言\nA\n# 1.1 日常\nB\n## 2.1 数据\nC\n### 2.1.2 运算\nD\n### 2.3.2 向量\nE',
    'n'
  );
  assert.deepEqual(
    parts.map(part => part.name),
    ['n-01-0.md', 'n-02-1.0.md', 'n-03-1.1.md', 'n-04-2.1.md', 'n-05-2.3.md']
  );
  assert.match(parts[3].markdown, /2\.1\.2 运算\nD/);
});
