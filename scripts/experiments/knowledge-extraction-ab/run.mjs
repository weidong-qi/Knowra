#!/usr/bin/env node
// 知识提炼提示词 A/B 实验：用同一批 Markdown 笔记分别跑线上 v1 提示词与 v2 草案，输出对比报告。
// 只读笔记文件、只调用 DeepSeek，不写知识库。API key 只从环境变量读取，不打印、不落盘。
// 默认输出到被 git 忽略的 storage/；原始报告含笔记摘录，禁止上传到公开仓库。
//
// 用法（仓库根目录，已 npm install）：
//   node scripts/experiments/knowledge-extraction-ab/run.mjs --notes <笔记目录或单个 .md> [--out <输出目录>]
//     [--existing <已有标题文件，每行一个>] [--variants v1,v2] [--model deepseek-chat] [--max-tokens 3072] [--key-env 变量名] [--dry-run]

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildUserPayload, checkResult, headingsOf, renderReport, splitBySection, summarize } from './lib.mjs';
import { PROMPT_V2_VERSION, buildPromptV2 } from './prompt-v2.mjs';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MAX_NOTE_CHARACTERS = 120_000;

export function parseArgs(argv) {
  const args = {
    variants: ['v1', 'v2'],
    model: 'deepseek-chat',
    out: 'storage/experiments/knowledge-extraction-ab',
    dryRun: false,
    temperature: 0,
    maxTokens: 8192
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} 缺少参数`);
      return value;
    };
    if (flag === '--notes') args.notes = next();
    else if (flag === '--out') args.out = next();
    else if (flag === '--existing') args.existing = next();
    else if (flag === '--variants')
      args.variants = next()
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    else if (flag === '--model') args.model = next();
    else if (flag === '--max-tokens') {
      args.maxTokens = Number(next());
      if (!Number.isSafeInteger(args.maxTokens) || args.maxTokens < 256 || args.maxTokens > 8192)
        throw new Error('--max-tokens 必须是 256 到 8192 的整数');
    } else if (flag === '--key-env') args.keyEnv = next();
    else if (flag === '--dry-run') args.dryRun = true;
    else throw new Error(`未知参数 ${flag}`);
  }
  if (!args.notes) throw new Error('需要 --notes <笔记目录或单个 Markdown 文件>');
  if (args.variants.some(variant => !['v1', 'v2'].includes(variant))) throw new Error('--variants 只支持 v1,v2');
  return args;
}

/** 优先使用 --key-env；否则在环境变量中找名字含 DEEPSEEK 且含 KEY/TOKEN 的那一个。 */
export function resolveApiKey(env, keyEnv) {
  if (keyEnv) return { name: keyEnv, value: env[keyEnv] };
  const names = Object.keys(env).filter(name => /deepseek/i.test(name) && /(key|token)/i.test(name) && env[name]);
  if (names.length > 1) throw new Error(`找到多个 DeepSeek 变量（${names.join('、')}），请用 --key-env 指定`);
  return { name: names[0], value: names[0] ? env[names[0]] : undefined };
}

async function loadNotes(target) {
  // 传入单个文件时按“章.节”切成多篇；传入目录时每个文件是一篇。
  if ((await stat(target)).isFile()) {
    const base =
      path
        .basename(target)
        .replace(/\.[^.]+$/, '')
        .replace(/[^\p{L}\p{N}]+/gu, '') || 'note';
    return splitBySection(await readFile(target, 'utf8'), base).filter(
      note => note.markdown.length <= MAX_NOTE_CHARACTERS
    );
  }
  const dir = target;
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
  const notes = [];
  for (const name of entries) {
    const markdown = await readFile(path.join(dir, name), 'utf8');
    if (!markdown.trim()) continue;
    if (markdown.length > MAX_NOTE_CHARACTERS) {
      console.warn(`跳过 ${name}：超过 ${MAX_NOTE_CHARACTERS} 字符`);
      continue;
    }
    notes.push({ name, markdown });
  }
  return notes;
}

async function callDeepSeek({ fetchImpl, apiKey, model, temperature, maxTokens, system, user }) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  const text = await response.text();
  // 第三方响应内容不写进 Actions 日志，避免将敏感服务信息意外公开。
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}；供应商响应正文已省略`);
  const body = JSON.parse(text);
  const choice = body.choices?.[0];
  if (choice?.finish_reason !== 'stop') throw new Error(`finish_reason=${choice?.finish_reason}`);
  return { content: choice.message?.content ?? '', usage: body.usage };
}

export async function main(argv, { env = process.env, fetchImpl = fetch, log = console.log, loadV1 } = {}) {
  const args = parseArgs(argv);
  const { v1Prompt, schema } = await (loadV1 ?? loadOnlinePrompt)();
  const prompts = { v1: v1Prompt, v2: buildPromptV2(schema) };
  const key = resolveApiKey(env, args.keyEnv);
  if (!args.dryRun && !key.value) throw new Error('没有找到 DeepSeek API key 环境变量，可用 --key-env 指定变量名');
  const notes = await loadNotes(args.notes);
  if (notes.length === 0) throw new Error(`${args.notes} 里没有 .md / .txt 笔记`);
  const seedTitles = args.existing
    ? (await readFile(args.existing, 'utf8'))
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
    : [];
  await mkdir(args.out, { recursive: true });
  log(
    `笔记 ${notes.length} 篇，变体 ${args.variants.join(' / ')}，模型 ${args.model}${key.name ? `，key 变量 ${key.name}` : ''}${args.dryRun ? '（dry-run，不调用模型）' : ''}`
  );

  const runsByVariant = {};
  for (const variant of args.variants) {
    // v2 模拟知识库逐渐增长：只有整篇候选全部通过当前线上引文定位规则，
    // 才把标题模拟采纳到下一篇。此为实验上下文，并非用户确认的正式知识。
    const existing = [...seedTitles];
    runsByVariant[variant] = [];
    for (const note of notes) {
      const sourceId = `source-${createHash('sha256').update(note.name).digest('hex').slice(0, 12)}`;
      const sources = [{ sourceId, markdown: note.markdown }];
      const requestId = `ab-${variant}-${sourceId}`;
      const existingTitles = variant === 'v2' ? [...existing] : [];
      const user = JSON.stringify(buildUserPayload({ variant, requestId, sources, existingTitles }));
      const run = {
        note: note.name,
        headings: headingsOf(note.markdown),
        existingTitles,
        check: { ok: false, candidates: [] }
      };
      if (args.dryRun) {
        await writeFile(
          path.join(args.out, `${variant}-${note.name}.request.json`),
          JSON.stringify({ system: prompts[variant], user: JSON.parse(user) }, null, 2)
        );
        run.check = { ok: true, batchError: null, candidates: [] };
      } else {
        try {
          const result = await callDeepSeek({
            fetchImpl,
            apiKey: key.value,
            model: args.model,
            temperature: args.temperature,
            maxTokens: args.maxTokens,
            system: prompts[variant],
            user
          });
          run.usage = result.usage;
          run.raw = result.content;
          run.check = checkResult({ content: result.content, requestId, sources });
        } catch (error) {
          run.error = error.message;
          run.check = { ok: false, batchError: null, candidates: [] };
        }
      }
      if (variant === 'v2' && run.check.ok) {
        for (const candidate of run.check.candidates) {
          if (!existing.includes(candidate.title)) existing.push(candidate.title);
        }
      }
      runsByVariant[variant].push(run);
      log(`  ${variant} ${note.name}：${run.error ? `失败 ${run.error}` : `${run.check.candidates.length} 个候选`}`);
    }
  }

  const summaries = Object.fromEntries(args.variants.map(variant => [variant, summarize(runsByVariant[variant])]));
  const report = renderReport({
    variants: args.variants,
    summaries,
    runsByVariant,
    meta: {
      generatedAt: new Date().toISOString(),
      model: args.model,
      temperature: args.temperature,
      notesLabel: path.basename(path.resolve(args.notes)),
      existingNote: seedTitles.length
        ? `预置 ${seedTitles.length} 条；整批校验通过才模拟累积（${PROMPT_V2_VERSION}）`
        : `无预置；整批校验通过才模拟累积（${PROMPT_V2_VERSION}）`
    }
  });
  await writeFile(path.join(args.out, 'report.md'), report);
  await writeFile(
    path.join(args.out, 'raw.json'),
    JSON.stringify(
      {
        runsByVariant,
        summaries: Object.fromEntries(
          Object.entries(summaries).map(([variant, summary]) => [variant, { ...summary, candidatesDetail: undefined }])
        )
      },
      null,
      2
    )
  );
  log(`报告：${path.join(args.out, 'report.md')}`);
  return { summaries, runsByVariant };
}

async function loadOnlinePrompt() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const gatewayFile = path.join(root, 'apps/api/src/modules/ai/knowledge-extraction-gateway.js');
  const gateway = await import(pathToFileURL(gatewayFile).href);
  const contract = await import(
    pathToFileURL(path.join(root, 'apps/api/src/modules/knowledge/application/knowledge-extraction-contract.js')).href
  );
  const schema = contract.KNOWLEDGE_EXTRACTION_OUTPUT_SCHEMA;
  if (typeof gateway.KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT === 'string')
    return { v1Prompt: gateway.KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT, schema };
  // 旧版本仓库未导出提示词常量时，从源码中取出同一段数组原文，保证 v1 与线上逐字一致。
  const source = await readFile(gatewayFile, 'utf8');
  const match = /const (?:SYSTEM_PROMPT|KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT) = (\[[\s\S]*?\])\.join\('\\n'\);/.exec(
    source
  );
  if (!match) throw new Error('无法从 knowledge-extraction-gateway.js 读取线上 v1 提示词');
  const lines = new Function('KNOWLEDGE_EXTRACTION_OUTPUT_SCHEMA', `return ${match[1]};`)(schema);
  return { v1Prompt: lines.join('\n'), schema };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`失败：${error.message}`);
    process.exitCode = 1;
  });
}
