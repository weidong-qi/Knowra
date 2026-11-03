import { describe, expect, it } from 'vitest';
import type { Annotation } from '@study-accelerator/web-core';
import { planNoteMigration, type AnnotationOutcome, type MigrationExclusion, type NoteMigrationPlan } from './annotationInlineMigration';
import { createMigrationCodec } from './annotationInlineMigration.testing';

/**
 * 重点内联化 I3 只读试运行：读取本机数据的只读导出，逐篇计算迁移结果并写出报告，不写回任何数据。
 * KNOWRA_I3_DRYRUN_INPUT 指向 { notes, contentAnnotations, annotationExclusions, annotationRevisions, knowledgeEvidence }，
 * KNOWRA_I3_DRYRUN_REPORT 为报告 HTML 路径（同目录另写 .json 汇总）。不设置时跳过。
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const inputPath = env.KNOWRA_I3_DRYRUN_INPUT;
const reportPath = env.KNOWRA_I3_DRYRUN_REPORT;

interface NoteRecord { id: string; title: string; rawMarkdown: string; deleted?: boolean; updatedAt?: string }
interface Input {
  exportedAt?: string;
  notes: NoteRecord[];
  contentAnnotations: Array<Annotation & { comment?: string }>;
  annotationExclusions: MigrationExclusion[];
  annotationRevisions: Array<{ annotationId: string }>;
  knowledgeEvidence: Array<{ annotationId?: string | null; sourceType: string }>;
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
const clip = (value: string | null | undefined, length = 80) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > length ? `${text.slice(0, length)}…` : text; };

/** 按行的最短编辑：只用于展示格式改写，最多列出 limit 处。 */
function lineChanges(before: string, after: string, limit = 12) {
  const a = before.split('\n'), b = after.split('\n');
  const n = a.length, m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const changes: Array<{ line: number; removed: string[]; added: string[] }> = [];
  let i = 0, j = 0, total = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i += 1; j += 1; continue; }
    const change = { line: i + 1, removed: [] as string[], added: [] as string[] };
    while ((i < n || j < m) && !(i < n && j < m && a[i] === b[j])) {
      if (j >= m || (i < n && table[i + 1][j] >= table[i][j + 1])) change.removed.push(a[i++]); else change.added.push(b[j++]);
    }
    total += 1;
    if (changes.length < limit) changes.push(change);
  }
  return { total, changes };
}

const STATUS_LABEL: Record<AnnotationOutcome['status'], string> = { migrated: '可迁移', unplaced: '需要处理', skipped: '跳过' };
const SCOPE_LABEL: Record<string, string> = { selection: '选区', blocks: '整块', section: '章节', list: '列表项' };
const KIND_LABEL: Record<string, string> = { important: '重点', question: '疑问', supplement: '补充', pitfall: '易错', temporary: '临时' };
const LEVEL_LABEL: Record<string, string> = { core: '核心', important: '重要', normal: '普通' };

function renderReport(input: Input, results: Array<{ note: NoteRecord; plan: NoteMigrationPlan; deps: Map<string, { evidence: number; revisions: number; comment: string }> }>) {
  const outcomes = results.flatMap(item => item.plan.outcomes.map(outcome => ({ ...outcome, note: item.note, deps: item.deps.get(outcome.annotationId)! })));
  const count = (status: AnnotationOutcome['status']) => outcomes.filter(item => item.status === status).length;
  const withIssues = results.filter(item => item.plan.issues.length);
  const rewrites = results.filter(item => item.plan.rewritesFormat);
  const unplaced = outcomes.filter(item => item.status === 'unplaced');
  const carried = outcomes.filter(item => item.status === 'migrated' && (item.deps.comment || item.deps.evidence));
  const row = (item: typeof outcomes[number], showNote = false) => `<tr class="s-${item.status}">
    ${showNote ? `<td>${escape(clip(item.note.title, 30))}</td>` : ''}
    <td><span class="badge b-${item.status}">${STATUS_LABEL[item.status]}</span></td>
    <td>${escape(SCOPE_LABEL[item.scopeType] ?? item.scopeType)}</td>
    <td>${escape(KIND_LABEL[item.kind] ?? item.kind)}${item.importance && item.importance !== 'normal' ? ` · ${escape(LEVEL_LABEL[item.importance] ?? item.importance)}` : ''}</td>
    <td>${escape(clip(item.quoteText))}</td>
    <td>${item.status === 'migrated' ? `${escape(clip(item.placedText))}${item.method === 'headingTitle' ? ' <span class="badge b-unplaced">按标题匹配</span>' : ''}` : `<span class="reason">${escape(item.reason)}</span>`}</td>
    <td class="mono">${escape(item.markId ?? '')}</td>
  </tr>`;
  const head = (showNote = false) => `<tr>${showNote ? '<th>笔记</th>' : ''}<th>结果</th><th>范围</th><th>类型</th><th>原摘录</th><th>迁移后覆盖 / 原因</th><th>标记 ID</th></tr>`;
  const noteSection = ({ note, plan }: typeof results[number]) => {
    const migrated = plan.outcomes.filter(item => item.status === 'migrated').length;
    const diff = plan.rewritesFormat ? lineChanges(note.rawMarkdown, plan.markdown.replace(/ ?<!--k[^>]*-->|<\/?mark[^>]*>/g, '')) : null;
    return `<details class="note${plan.issues.length ? ' has-issues' : ''}">
      <summary><strong>${escape(note.title)}</strong>${note.deleted ? ' <span class="badge b-skipped">回收站</span>' : ''}
        <span class="meta">${plan.outcomes.length} 条重点 · 可迁移 ${migrated}${plan.rewritesFormat ? ' · <span class="warn">会改写格式</span>' : ''}${plan.issues.length ? ` · <span class="bad">自检 ${plan.issues.length} 个问题</span>` : ''}</span></summary>
      ${plan.issues.length ? `<ul class="issues">${plan.issues.map(issue => `<li>${escape(issue)}</li>`).join('')}</ul>` : ''}
      ${plan.outcomes.length ? `<div class="table-wrap"><table>${head()}${plan.outcomes.map(outcome => row({ ...outcome, note, deps: { evidence: 0, revisions: 0, comment: '' } })).join('')}</table></div>` : ''}
      ${diff ? `<h4>格式改写（共 ${diff.total} 处，列出前 ${diff.changes.length} 处；不含新加的标记）</h4>${diff.changes.map(change => `<div class="diff"><div class="ln">第 ${change.line} 行</div>${change.removed.map(line => `<div class="del">− ${escape(line) || '（空行）'}</div>`).join('')}${change.added.map(line => `<div class="add">+ ${escape(line) || '（空行）'}</div>`).join('')}</div>`).join('')}` : ''}
    </details>`;
  };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>重点迁移试运行</title>
<style>
:root{--bg:#f7f6f3;--panel:#fff;--text:#1f2328;--muted:#6b6f76;--line:#e4e2dd;--ok:#2f7d4f;--ok-bg:#e7f3eb;--warn:#9a6700;--warn-bg:#fbf1d9;--bad:#b42318;--bad-bg:#fbe9e7;--skip:#6b6f76;--skip-bg:#efeeea}
@media (prefers-color-scheme:dark){:root{--bg:#17181a;--panel:#202124;--text:#e8e6e3;--muted:#9a9da3;--line:#33353a;--ok:#6fcf97;--ok-bg:#1d3326;--warn:#e2b340;--warn-bg:#3a3020;--bad:#f28b82;--bad-bg:#3b2422;--skip:#9a9da3;--skip-bg:#2a2b2e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 10px}h4{font-size:13px;margin:14px 0 6px;color:var(--muted)}
.lead{color:var(--muted);margin:0 0 20px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card b{display:block;font-size:24px;font-variant-numeric:tabular-nums}.card span{color:var(--muted);font-size:12px}
.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;font-size:13px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600;color:var(--muted);font-size:12px;white-space:nowrap}
.badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:12px;white-space:nowrap}.b-migrated{background:var(--ok-bg);color:var(--ok)}.b-unplaced{background:var(--warn-bg);color:var(--warn)}.b-skipped{background:var(--skip-bg);color:var(--skip)}
.reason{color:var(--warn)}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--muted)}.warn{color:var(--warn)}.bad{color:var(--bad)}
details.note{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:8px 0;padding:10px 14px}details.note.has-issues{border-color:var(--bad)}
summary{cursor:pointer}summary .meta{color:var(--muted);font-size:12px;margin-left:8px}ul.issues{color:var(--bad);margin:10px 0}
.diff{font-family:ui-monospace,Menlo,monospace;font-size:12px;border:1px solid var(--line);border-radius:6px;margin:6px 0;overflow-x:auto}.diff .ln{padding:3px 8px;color:var(--muted);border-bottom:1px solid var(--line)}
.diff .del{background:var(--bad-bg);padding:1px 8px;white-space:pre-wrap}.diff .add{background:var(--ok-bg);padding:1px 8px;white-space:pre-wrap}
.note-text{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
</style></head><body><main>
<h1>重点迁移试运行</h1>
<p class="lead">只读计算，没有写回任何数据。数据导出于 ${escape(input.exportedAt ?? '未知时间')}，报告生成于 ${escape(new Date().toLocaleString('zh-CN'))}。</p>
<div class="cards">
  <div class="card"><b>${input.contentAnnotations.length}</b><span>重点总数</span></div>
  <div class="card"><b style="color:var(--ok)">${count('migrated')}</b><span>可以自动迁移</span></div>
  <div class="card"><b style="color:var(--warn)">${count('unplaced')}</b><span>需要你处理（未落位）</span></div>
  <div class="card"><b>${count('skipped')}</b><span>已取消/归档，跳过</span></div>
  <div class="card"><b style="color:${withIssues.length ? 'var(--bad)' : 'var(--ok)'}">${withIssues.length}</b><span>自检有问题的笔记</span></div>
  <div class="card"><b style="color:var(--warn)">${rewrites.length}</b><span>打开即改写格式的笔记</span></div>
</div>
<h2>需要你处理的重点（${unplaced.length}）</h2>
${unplaced.length ? `<div class="table-wrap"><table>${head(true)}${unplaced.map(item => row(item, true)).join('')}</table></div>` : '<p class="lead">没有。</p>'}
<h2>按标题匹配定位的章节（${outcomes.filter(item => item.method === 'headingTitle').length}）</h2>
<p class="lead">编辑器的章节定位在这些笔记里失败（整篇标题与投影不一致），改为按"同级同名标题的第几个"匹配，请重点核对。</p>
${outcomes.some(item => item.method === 'headingTitle') ? `<div class="table-wrap"><table>${head(true)}${outcomes.filter(item => item.method === 'headingTitle').map(item => row(item, true)).join('')}</table></div>` : ''}
<h2>迁移时要带过去的内容（${carried.length}）</h2>
${carried.length ? `<div class="table-wrap"><table><tr><th>笔记</th><th>原摘录</th><th>备注</th><th>关联证据</th></tr>${carried.map(item => `<tr><td>${escape(clip(item.note.title, 30))}</td><td>${escape(clip(item.quoteText, 40))}</td><td>${escape(clip(item.deps.comment, 60))}</td><td>${item.deps.evidence}</td></tr>`).join('')}</table></div>` : '<p class="lead">没有带备注或被知识证据引用的重点。</p>'}
<h2>打开即改写格式的笔记（${rewrites.length}）</h2>
<p class="lead">这些笔记即使不迁移，只要在编辑器里打开再保存，格式也会被改写（如列表符号、空行、表格对齐）。迁移会保存编辑器的版本，下面每篇的明细里列出了具体改动。</p>
<h2>逐篇明细（${results.length}）</h2>
${results.map(noteSection).join('')}
</main></body></html>`;
}

describe('重点内联化 I3 只读试运行', () => {
  it.skipIf(!inputPath || !reportPath)('逐篇计算迁移结果并写出报告', async () => {
    const fs = await import('node:fs' as string) as { readFileSync(path: string, encoding: string): string; writeFileSync(path: string, data: string): void; mkdirSync(path: string, options: object): void };
    const input = JSON.parse(fs.readFileSync(inputPath!, 'utf8')) as Input;
    const codec = await createMigrationCodec();
    const results: Array<{ note: NoteRecord; plan: NoteMigrationPlan; deps: Map<string, { evidence: number; revisions: number; comment: string }> }> = [];
    try {
      for (const note of [...input.notes].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))) {
        const annotations = input.contentAnnotations.filter(item => item.noteId === note.id);
        const ids = new Set(annotations.map(item => item.id));
        const plan = planNoteMigration({ markdown: note.rawMarkdown ?? '', annotations, exclusions: input.annotationExclusions.filter(item => ids.has(item.parentAnnotationId)) }, codec);
        const deps = new Map(annotations.map(item => [item.id, {
          evidence: input.knowledgeEvidence.filter(evidence => evidence.annotationId === item.id).length,
          revisions: input.annotationRevisions.filter(revision => revision.annotationId === item.id).length,
          comment: item.comment ?? ''
        }]));
        if (annotations.length || plan.rewritesFormat || plan.issues.length) results.push({ note, plan, deps });
      }
    } finally {
      await codec.destroy();
    }
    fs.writeFileSync(reportPath!, renderReport(input, results));
    const summary = results.map(({ note, plan }) => ({
      noteId: note.id, title: note.title, deleted: Boolean(note.deleted), rewritesFormat: plan.rewritesFormat, issues: plan.issues,
      outcomes: plan.outcomes.map(({ annotationId, markId, status, reason, scopeType, method }) => ({ annotationId, markId, status, reason, scopeType, method }))
    }));
    fs.writeFileSync(reportPath!.replace(/\.html$/, '.json'), JSON.stringify(summary, null, 2));
    expect(results.length).toBeGreaterThan(0);
  }, 300_000);
});
