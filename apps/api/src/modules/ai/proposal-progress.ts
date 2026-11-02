import type { SourceRange } from './access-service-types.ts';

interface ProposalToolCall {
  toolName: string;
  status: string;
  resultJson?: object | null;
  sourceRefs?: readonly SourceRange[];
}
/** 持久工具结果未按工具种类校验；这里只表示原代码读取的外部字段。 */
interface RawToolResult {
  noteId?: unknown;
  total?: unknown;
  offset?: unknown;
  annotations?: unknown;
  saved?: unknown;
  candidates?: { length?: unknown } | null;
  citedRanges?: unknown;
}
interface RawProgressAnnotation {
  annotationId?: unknown;
  importance?: unknown;
  start?: unknown;
  end?: unknown;
}
type RawCitedRange = Partial<Record<keyof SourceRange, unknown>>;
interface TrackedAnnotation extends RawProgressAnnotation {
  index: number;
}
interface ProgressNote {
  total: number;
  seen: Map<RawProgressAnnotation['annotationId'], TrackedAnnotation>;
  handled: Set<RawProgressAnnotation['annotationId']>;
  nextOffset: number;
  read: boolean;
  listed: boolean;
}

// 提炼知识点回合的行为指引：把“读后提交候选”说清楚，避免模型只在回答里罗列或反复读取同一份重点。
export const PROPOSAL_GUIDANCE =
  '\n这是提炼知识点请求：先用 annotations_list 取得重点（需要时用 notes_read 读上下文）；“已完成”说明会告诉你哪些步骤已成功、重点是否读完；不要用相同参数重复调用同一个工具；重点很多、sources 放不下时分批处理：读一页重点、提交一批候选，再用 offset 翻到下一页。随后调用 knowledge_propose 一次性提交候选，只有调用 knowledge_propose 才算提交，在回答里声称已提交或罗列知识点都无效。每条候选只依据所引原文；引文只需给 noteId 和逐字摘自 sources 的 quote，不要自己数字符偏移。提交成功后用一两句话说明已提交几条待用户审核的候选，不要重复列出内容。';
// 工具结果只以来源片段回到模型，看不到“已成功”。提炼回合另用一句话说明已完成的步骤，避免模型因看不到结果而反复调用、迟迟不提交。
// 说明只能描述“本轮真的会随请求发出的来源”：按当前 sources 窗口（sourceRefs，发送前会逐条重新核验权限与版本）过滤，
// 窗口外（被淘汰）的笔记不再提及；不含笔记标题，避免经说明文字绕过发送清单与授权复核。
// 重点数量可能超过 sources 窗口容量，所以按“批”推进：把重点分成 未读 / 已读待提交（在窗口内或已移出）/ 已提交 三类，
// 先提交窗口内待提交的，再翻页读下一批；只有被已保存候选引文实际覆盖的重点才算已提交，其余仍待处理。
export function analyzeProposal(
  calls: readonly ProposalToolCall[],
  sourceRefs: readonly SourceRange[] = [],
  capacity: number | null = null
) {
  // 局部操作视图保留未校验位置的原比较/算术语义，不把外部标注记录声明为有效DTO。
  const live = (noteId: string, start: RawProgressAnnotation['start'], end: RawProgressAnnotation['end']) =>
    sourceRefs.some(ref => ref.noteId === noteId && ref.start <= (start as number) && (end as number) <= ref.end);
  const done = calls.filter(
    call => call.status === 'succeeded' && call.resultJson && typeof call.resultJson === 'object'
  );
  const notes = new Map<string, ProgressNote>();
  const noteOf = (id: string) =>
    notes.get(id) ??
    notes
      .set(id, {
        total: 0,
        seen: new Map<RawProgressAnnotation['annotationId'], TrackedAnnotation>(),
        handled: new Set<RawProgressAnnotation['annotationId']>(),
        nextOffset: 0,
        read: false,
        listed: false
      })
      .get(id)!;
  // candidates.length没有类型校验，原+=也可能得到字符串。
  let saved: number | string = 0;
  const cited: SourceRange[] = [];
  for (const call of done) {
    const result = call.resultJson as RawToolResult;
    if (
      call.toolName === 'annotations_list' &&
      typeof result.noteId === 'string' &&
      Number.isSafeInteger(result.total)
    ) {
      const note = noteOf(result.noteId);
      note.total = result.total as number;
      note.listed = true;
      ((result.annotations as RawProgressAnnotation[] | null | undefined) ?? []).forEach((item, position) =>
        note.seen.set(item.annotationId, {
          ...item,
          index: (Number.isSafeInteger(result.offset) ? (result.offset as number) : 0) + position
        })
      );
      if (Number.isSafeInteger(result.offset))
        note.nextOffset = Math.max(
          note.nextOffset,
          (result.offset as number) +
            (((result.annotations as { length?: unknown } | null | undefined)?.length ?? 0) as number)
        );
    } else if (
      call.toolName === 'notes_read' &&
      typeof result.noteId === 'string' &&
      (call.sourceRefs ?? []).some(ref => ref.noteId === result.noteId && live(ref.noteId, ref.start, ref.end))
    )
      noteOf(result.noteId).read = true;
    else if (call.toolName === 'knowledge_propose' && result.saved === true) {
      saved += (result.candidates?.length ?? 0) as number;
      for (const range of (result.citedRanges as (RawCitedRange | null | undefined)[] | null | undefined) ?? []) {
        if (
          typeof range?.noteId === 'string' &&
          Number.isSafeInteger(range.start) &&
          Number.isSafeInteger(range.end) &&
          (range.start as number) < (range.end as number)
        )
          cited.push(range as SourceRange);
      }
    }
  }
  // 只把“被已保存候选的引文实际覆盖”的重点算作已提交：引文与重点原文相交，且引文不超过重点长度的 3 倍
  // （排除用整篇原文当引文而“顺带覆盖”所有重点的情形）。保存成功本身不代表此前读到的重点都已处理。
  for (const [noteId, note] of notes) {
    for (const item of note.seen.values()) {
      if (
        cited.some(
          range =>
            range.noteId === noteId &&
            range.start < (item.end as number) &&
            (item.start as number) < range.end &&
            range.end - range.start <= 3 * ((item.end as number) - (item.start as number))
        )
      )
        note.handled.add(item.annotationId);
    }
  }
  const steps: string[] = [];
  let needPropose = false,
    needPage = false,
    needReread = false;
  for (const [noteId, note] of notes) {
    const inWindow = [...note.seen.values()].filter(item => live(noteId, item.start, item.end));
    const pending = inWindow.filter(item => !note.handled.has(item.annotationId));
    const lost = [...note.seen.values()].filter(
      item => !live(noteId, item.start, item.end) && !note.handled.has(item.annotationId)
    );
    const dropped = lost.length,
      lostFrom = Math.min(...lost.map(item => item.index));
    const unread = note.total - note.seen.size;
    if (note.total) {
      if (!inWindow.length && !note.read) continue; // 来源窗口已淘汰该笔记：不再提及，需要时模型可重新读取
      const counts = new Map<RawProgressAnnotation['importance'], number>();
      for (const item of pending) counts.set(item.importance, (counts.get(item.importance) ?? 0) + 1);
      const detail = [...counts].map(([level, count]) => `${level}×${count}`).join('、');
      // 明确“待提交的重点原文就是哪几个 source、各自重要度”：sources 的编号即其在 sourceRefs 中的顺序（与 prepareRequest 一致）。
      const labels = pending
        .map(item => ({
          item,
          index: sourceRefs.findIndex(ref => ref.noteId === noteId && ref.start === item.start && ref.end === item.end)
        }))
        .filter(entry => entry.index >= 0)
        .map(entry => `S${entry.index + 1}（${entry.item.importance}）`);
      if (pending.length) needPropose = true;
      if (unread > 0) needPage = true;
      if (dropped > 0) needReread = true;
      steps.push(
        `annotations_list 已读取一篇笔记 ${note.total} 处重点中的 ${note.seen.size} 处，其中 ${note.handled.size} 处已提交` +
          `${pending.length ? `；${pending.length} 处待提交且原文在当前 sources 中（${detail}），即 ${labels.join('、')}，其余 source 只是上下文` : ''}` +
          `${unread > 0 ? `；还有 ${unread} 处未读，可用 offset=${note.nextOffset} 继续翻页` : ''}` +
          `${dropped > 0 ? `；${dropped} 处已读但原文已移出 sources 且尚未提交（${capacity ? `sources 一次约容纳 ${capacity} 条，` : ''}可从 offset=${lostFrom} 起用 limit=${capacity ? Math.max(1, capacity) : '较小值'} 重新读取）` : ''}`
      );
    } else if (note.listed && !note.seen.size && sourceRefs.some(ref => ref.noteId === noteId))
      steps.push('annotations_list 显示一篇笔记没有可用重点，可读取正文后提炼');
    if (note.read) steps.push('notes_read 已读取一篇笔记的原文片段，已在 sources 中');
  }
  if (saved) steps.push(`knowledge_propose 已保存 ${saved} 条待审核候选（同一陈述不要重复提交）`);
  if (!steps.length) return { text: '', needPropose };
  const batch = needPage
    ? '；提交后再翻页读取剩余重点，读一批提交一批'
    : needReread
      ? '；提交后再用 annotations_list 重新读取被移出的重点，读一批提交一批'
      : '';
  const next = needPropose
    ? `sources 放不下全部重点，不必等读完：现在就对上面待提交的重点调用 knowledge_propose${batch}。`
    : needPage
      ? '先别重复读取已读的页：继续用 annotations_list 翻页读取剩余重点，读到一批就提交一批。'
      : needReread
        ? '用 annotations_list 按上面给出的 offset 和 limit 重新读取被移出 sources 的重点（读一批提交一批；limit 不要超过 sources 的容量）。'
        : saved
          ? '重点已全部处理，请用一两句话告知用户。'
          : '这些步骤不要重复；信息已足够时现在调用 knowledge_propose 提交候选。';
  return { text: `\n已完成：${steps.join('；')}。${next}`, needPropose };
}
export const proposalProgress = (
  calls: readonly ProposalToolCall[],
  sourceRefs: readonly SourceRange[] = [],
  capacity: number | null = null
) => analyzeProposal(calls, sourceRefs, capacity).text;
