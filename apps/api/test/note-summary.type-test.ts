import {
  createNoteSummary,
  type NoteSummary,
  type NoteSummaryInput,
  type NoteSummaryOutlineEntry
} from '../src/modules/knowledge/application/note-summary.ts';
import { createNoteSummary as bridge } from '../src/modules/knowledge/application/note-summary.js';
import { createNoteSummary as searchProjection } from '../src/modules/knowledge/application/postgres-async/search-service.js';
import { Note } from '../src/modules/knowledge/domain/note.ts';
import {
  createInMemoryNoteRepository,
  type NoteRecord
} from '../src/modules/knowledge/infrastructure/note-repository.ts';
import { createPostgresNoteRepository } from '../src/modules/knowledge/infrastructure/postgres/note-repository.js';
import { createNoteService } from '../src/modules/knowledge/application/note-service.js';
import { createAsyncNoteService } from '../src/modules/knowledge/application/postgres-async/note-service.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Assert<Value extends true> = Value;
type IsAny<Value> = 0 extends 1 & Value ? true : false;

const domain = new Note({ id: 'n', title: '标题', rawMarkdown: '# 正文' });
const _domain = createNoteSummary(domain);
const _bridge = bridge(domain);
const _search = searchProjection(domain);
const historical = {
  id: Symbol('id'),
  spaceId: { old: true },
  folderId: 42n,
  title: false,
  plainText: Symbol('plain'),
  rawMarkdown: { toString: () => '# title' },
  internalLinks: [42, false, Symbol()],
  status: 7,
  sourceType: new Date(),
  favorite: 'legacy',
  aiVisibility: false,
  deleted: Symbol('deleted'),
  tagIds: [undefined, null, 1n],
  createdAt: null,
  updatedAt: { old: true },
  extra: 'not projected'
};
const _historical = createNoteSummary(historical);
const _default = createNoteSummary({});
const _undefined = createNoteSummary({ aiVisibility: undefined });
const _null = createNoteSummary({ aiVisibility: null });
const _normal = createNoteSummary({ aiVisibility: 'normal' });
const _zero = createNoteSummary({ aiVisibility: 0 });
const _false = createNoteSummary({ aiVisibility: false });
const _symbol = createNoteSummary({ aiVisibility: Symbol() });
const raw: NoteSummaryInput = historical;
const _raw = createNoteSummary(raw);
const readonly = Object.freeze({ id: 'immutable', tagIds: ['a'], internalLinks: ['b'] });
const _readonly = createNoteSummary(readonly);

// 自定义迭代器即使挂在字符串数组上，也不会得到 string[] 的虚假承诺。
const customArray = Object.assign(['a'], {
  *[Symbol.iterator]() {
    yield 42;
  }
});
const _custom = createNoteSummary({ internalLinks: customArray, tagIds: customArray });
let reads = 0;
const _changing = createNoteSummary({
  get internalLinks() {
    return reads++ === 0 ? ['a'] : new Set([42]);
  },
  get tagIds() {
    return reads++ === 0 ? ['a'] : 'arbitrary iterable';
  }
});

const local = createInMemoryNoteRepository({ records: [domain] });
const _rows = local.list().map(createNoteSummary);
const _record: NoteRecord = { id: 'stored', title: '旧记录', rawMarkdown: '', status: { legacy: true } };
const _recordProjection = createNoteSummary(_record);
const localService = createNoteService({ repository: local });
const _localRows = localService.listNotes({ summaryOnly: true });
const _localDirect = localService.getNote('n');
// 异步仓库和服务尚未迁移；这里证明既有装配仍可调用，不把其 any 当作端到端类型安全。
const postgres = createPostgresNoteRepository({ db: { note: {} } });
const asyncOptions = { repository: postgres, annotationRepository: null };
const asyncService = createAsyncNoteService(asyncOptions);
const _asyncRows = asyncService.listNotes({ summaryOnly: true });

export type NoteSummaryContracts = [
  Assert<Equal<typeof _bridge, typeof _domain>>,
  Assert<Equal<typeof _search, typeof _domain>>,
  Assert<Equal<typeof _domain.id, string>>,
  Assert<Equal<typeof _domain.spaceId, string | null>>,
  Assert<Equal<typeof _domain.folderId, string | null>>,
  Assert<Equal<typeof _domain.title, string>>,
  Assert<Equal<typeof _domain.status, string>>,
  Assert<Equal<typeof _domain.sourceType, string>>,
  Assert<Equal<typeof _domain.favorite, boolean>>,
  Assert<Equal<typeof _domain.aiVisibility, string>>,
  Assert<Equal<typeof _domain.deleted, boolean>>,
  Assert<Equal<typeof _domain.createdAt, string | null>>,
  Assert<Equal<typeof _domain.updatedAt, string | null>>,
  Assert<Equal<typeof _domain.summary, string>>,
  Assert<Equal<typeof _domain.characterCount, number>>,
  Assert<Equal<typeof _domain.readingMinutes, number>>,
  Assert<Equal<typeof _domain.outline, NoteSummaryOutlineEntry[]>>,
  Assert<Equal<typeof _domain.contentLoaded, false>>,
  Assert<Equal<typeof _domain.internalLinks, unknown[]>>,
  Assert<Equal<typeof _domain.tagIds, unknown[]>>,
  Assert<Equal<typeof _historical.id, symbol>>,
  Assert<Equal<typeof _historical.spaceId, { old: boolean }>>,
  Assert<Equal<typeof _historical.folderId, bigint>>,
  Assert<Equal<typeof _historical.title, boolean>>,
  Assert<Equal<typeof _historical.status, number>>,
  Assert<Equal<typeof _historical.sourceType, Date>>,
  Assert<Equal<typeof _historical.favorite, string>>,
  Assert<Equal<typeof _historical.aiVisibility, boolean | 'normal'>>,
  Assert<Equal<typeof _historical.deleted, symbol>>,
  Assert<Equal<typeof _historical.createdAt, null>>,
  Assert<Equal<typeof _historical.updatedAt, { old: boolean }>>,
  Assert<Equal<typeof _undefined.aiVisibility, 'normal'>>,
  Assert<Equal<typeof _null.aiVisibility, 'normal'>>,
  Assert<Equal<typeof _normal.aiVisibility, string>>,
  Assert<Equal<typeof _zero.aiVisibility, number | 'normal'>>,
  Assert<Equal<typeof _false.aiVisibility, boolean | 'normal'>>,
  Assert<Equal<typeof _symbol.aiVisibility, symbol | 'normal'>>,
  Assert<Equal<typeof _raw.id, unknown>>,
  Assert<Equal<typeof _raw.title, unknown>>,
  Assert<Equal<typeof _raw.aiVisibility, NonNullable<unknown> | 'normal'>>,
  Assert<Equal<typeof _default.id, unknown>>,
  Assert<Equal<typeof _readonly.id, 'immutable'>>,
  Assert<Equal<typeof _custom.internalLinks, unknown[]>>,
  Assert<Equal<typeof _custom.tagIds, unknown[]>>,
  Assert<Equal<typeof _changing.internalLinks, unknown[]>>,
  Assert<Equal<typeof _changing.tagIds, unknown[]>>,
  Assert<Equal<(typeof _rows)[number], NoteSummary<NoteRecord>>>,
  Assert<Equal<typeof _recordProjection.status, unknown>>,
  Assert<Equal<typeof _recordProjection.id, string>>,
  Assert<Equal<(typeof _localRows)[number], NoteRecord | NoteSummary<NoteRecord>>>,
  Assert<Equal<typeof _localDirect, NoteRecord>>,
  Assert<Equal<IsAny<Awaited<typeof _asyncRows>>, true>>,
  Assert<Equal<IsAny<typeof _raw.id>, false>>,
  Assert<Equal<IsAny<(typeof _custom.internalLinks)[number]>, false>>,
  Assert<Equal<IsAny<(typeof _rows)[number]>, false>>,
  Assert<Equal<ReturnType<typeof createNoteSummary>, NoteSummary<NoteSummaryInput>>>,
  Assert<Equal<Parameters<typeof createNoteSummary>, [note: NoteSummaryInput]>>
];

// @ts-expect-error 缺少记录参数。
createNoteSummary();
// @ts-expect-error null 在首次可选读取后会因直接属性读取而失败，不承诺正常返回。
createNoteSummary(null);
// @ts-expect-error undefined 不属于正常返回契约。
createNoteSummary(undefined);
// @ts-expect-error 不提供任意原始值的记录契约。
createNoteSummary(7);
// @ts-expect-error 输入约束不是任意无关结构。
createNoteSummary({ unrelated: true });
// @ts-expect-error 不投影额外字段。
const _missingExtra = _historical.extra;
// @ts-expect-error 不携带原始正文。
const _missingRawMarkdown = _domain.rawMarkdown;
// @ts-expect-error 不携带纯文本。
const _missingPlainText = _domain.plainText;
// @ts-expect-error 历史 id 保留 symbol，不伪装为 string。
const _badId: string = _historical.id;
// @ts-expect-error unknown 字段没有经过校验。
const _badRawId: string = _raw.id;
// @ts-expect-error 字符串数组输入依然可能使用自定义迭代器。
const _badLinks: string[] = _domain.internalLinks;
// @ts-expect-error tagIds 的迭代结果也保持 unknown[]。
const _badTags: string[] = _domain.tagIds;
// @ts-expect-error 自定义迭代器不会保留数组元素声明。
const _badCustom: string[] = _custom.internalLinks;
// @ts-expect-error 第二次 getter 读取不保证仍为字符串数组。
const _badChanging: string[] = _changing.tagIds;
// @ts-expect-error false 是 aiVisibility 的有效透传结果。
const _badVisibility: string = _false.aiVisibility;
// @ts-expect-error 数值不是字符串可见性。
const _badZero: string = _zero.aiVisibility;
// @ts-expect-error 未校验的状态不提升成枚举。
const _badStatus: string = _recordProjection.status;
// @ts-expect-error 摘要始终 string。
const _badSummary: number = _domain.summary;
// @ts-expect-error 字符数始终 number。
const _badCount: string = _domain.characterCount;
// @ts-expect-error 阅读时长始终 number。
const _badMinutes: string = _domain.readingMinutes;
// @ts-expect-error 大纲标题是字符串。
const _badOutline: Array<{ level: number; title: number }> = _domain.outline;
// @ts-expect-error 标记始终 false。
const _badLoaded: true = _domain.contentLoaded;
// @ts-expect-error 历史时间不提升为字符串。
const _badTime: string = _historical.updatedAt;
// @ts-expect-error 真实本地服务列表是明细或摘要，不承诺全有 rawMarkdown。
const _missingListRawMarkdown = _localRows[0].rawMarkdown;
// @ts-expect-error 摘要不满足需要正文的真实本地仓库保存契约。
local.save(_domain);

// 显式依赖契约已补齐 repository；验证无可选依赖时仍可装配。
createAsyncNoteService({ repository: postgres });
