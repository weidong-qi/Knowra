export interface SyncNote { title: string; rawMarkdown: string; deleted: boolean; [key: string]: unknown }
export interface Conflict {
  noteId: string; kind: string; base: SyncNote | null; local: SyncNote | null; remote: SyncNote | null;
  remoteRevision: number | null; datasetEpoch: string;
}
export interface EntityValue { title?: string; name?: string; rawMarkdown?: string; deleted?: boolean; [key: string]: unknown }
export interface EntityConflictItem { collection: string; id: string; base: EntityValue | null; local: EntityValue | null; remote: EntityValue | null }
export interface EntityConflict {
  id: string; changedEpoch: boolean; items: EntityConflictItem[];
  reasons: { collection: string; id: string; message?: string }[];
}

export const entityNames: Record<string, string> = { spaces: '空间', folders: '目录', tagGroups: '标签组', tags: '标签', notes: '笔记', noteVersions: '历史版本', attachments: '附件', contentAnnotations: '重点标记', annotationExclusions: '排除范围', annotationRevisions: '标注修订', dependencies: '关联关系', knowledgeItems: '知识', knowledgeEvidence: '知识来源', learningObjectives: '学习目标', examProfiles: '考试配置', examFocuses: '考点', questions: '题目', questionObjectives: '题目目标关系', questionSources: '题目来源' };
const fieldNames: Record<string, string> = {
  id: '编号', title: '标题', name: '名称', description: '说明', color: '颜色', icon: '图标', order: '顺序', sortOrder: '排序',
  spaceId: '所属空间', folderId: '所属目录', parentId: '上级目录', groupId: '标签组', tagIds: '标签', noteId: '所属笔记',
  noteVersionId: '来源版本', annotationId: '关联重点标记', parentAnnotationId: '上级重点标记', deleted: '回收站状态', deletedAt: '移入回收站时间',
  rawMarkdown: '正文', createdAt: '创建时间', updatedAt: '更新时间', fileName: '文件名', filename: '文件名', originalName: '原文件名',
  mimeType: '文件类型', size: '文件大小', byteSize: '文件大小', sha256: '文件校验值', contentHash: '正文校验值', status: '状态',
  anchors: '定位信息', anchor: '定位信息', start: '起点', end: '终点', startOffset: '起始位置', endOffset: '结束位置',
  quote: '引用文本', text: '文本', selectedText: '选中文本', prefix: '前文', suffix: '后文', kind: '类型', type: '类型',
  level: '级别', scope: '范围', ranges: '范围', source: '来源', sourceNoteId: '来源笔记', sourceVersionId: '来源版本',
  sourceState: '来源状态', matchMode: '匹配方式', content: '内容', sequence: '序号', reason: '原因', enabled: '启用状态',
  startLine: '起始行', endLine: '结束行', blockId: '段落编号', blockIndex: '段落序号', sourceText: '来源文本',
  exact: '原文', selector: '定位规则', selectors: '定位规则', revision: '修订号', version: '版本', label: '标签名称',
  sourceType: '来源类型', favorite: '收藏状态', internalLinks: '内部链接', charCount: '字符数', userId: '所属用户',
  scopeType: '标注范围', lifecycleStatus: '标记状态', quoteText: '引用原文', sourceMode: '创建方式', originSnapshot: '原始内容快照',
  anchorStatus: '定位状态', anchorReason: '定位变化原因', importance: '重要程度', comment: '批注', headingPath: '标题路径',
  fromPosition: '起始位置', toPosition: '结束位置', prefixText: '前文', suffixText: '后文', segments: '文本片段',
  anchorFingerprint: '定位指纹', noteContentHash: '笔记正文校验值', idempotencyKey: '操作标识', schemaVersion: '数据格式版本',
  resolvedContentHash: '已定位正文校验值', boundaryFingerprint: '范围边界指纹', requestHash: '请求校验值', operation: '变更操作',
  createdBy: '创建者', canonicalStatement: '核心陈述', userExplanation: '我的解释', knowledgeType: '知识类型', reviewStatus: '审核状态', knowledgeItemId: '所属知识', relationType: '支持关系', sourceStatus: '来源状态', sourceSnapshot: '来源快照', provenance: '提炼记录', objective: '学习目标', actionVerb: '动作', cognitiveLevel: '认知层级', learningObjectiveId: '关联学习目标', learningObjectiveIds: '关联学习目标', examProfileId: '所属考试配置', questionId: '所属题目', questionType: '题型', stem: '题干', options: '选项', referenceAnswer: '参考答案', rubric: '评分标准', explanation: '解析', difficulty: '难度', weight: '权重', score: '分值', reviewNote: '审阅说明', archivedAt: '归档时间', priority: '优先级', difficultyHint: '难度提示', questionTypeSuggestions: '建议题型', commonQuestionTypes: '常见题型', difficultyProfile: '难度配置', language: '语言'
};
const ignored = new Set(['id', 'rawMarkdown', 'plainText', 'createdAt', 'updatedAt', 'storagePath', 'verifiedAt', 'pathCache']);
const referenceCollections: Record<string, string> = { knowledgeItemId: 'knowledgeItems', learningObjectiveId: 'learningObjectives', learningObjectiveIds: 'learningObjectives', examProfileId: 'examProfiles', questionId: 'questions', spaceId: 'spaces', folderId: 'folders', parentId: 'folders', groupId: 'tagGroups', tagIds: 'tags', internalLinks: 'notes', noteId: 'notes', noteVersionId: 'noteVersions', annotationId: 'contentAnnotations', parentAnnotationId: 'contentAnnotations' };
const enumNames: Record<string, Record<string, string>> = {
  sourceType: { learningObjective: '学习目标', knowledgeItem: '知识', knowledgeEvidence: '知识来源', annotation: '笔记标注', noteVersion: '笔记版本', manual: '手动创建', ai: 'AI 辅助', pastPaper: '历年试题', syllabus: '考试大纲', 'markdown-import': 'Markdown 导入', 'web-clip': '网页摘录' },
  actionVerb: { identify: '识别', explain: '解释', apply: '应用', calculate: '计算', compare: '比较', analyze: '分析', design: '设计', evaluate: '评价' },
  cognitiveLevel: { remember: '记忆', understand: '理解', apply: '应用', analyze: '分析' },
  questionType: { singleChoice: '单选题', multipleChoice: '多选题', trueFalse: '判断题', shortAnswer: '简答题' },
  difficulty: { easy: '简单', medium: '中等', hard: '困难' },
  difficultyHint: { easy: '简单', medium: '中等', hard: '困难' },
  commonQuestionTypes: { singleChoice: '单选题', multipleChoice: '多选题', trueFalse: '判断题', shortAnswer: '简答题' },
  questionTypeSuggestions: { singleChoice: '单选题', multipleChoice: '多选题', trueFalse: '判断题', shortAnswer: '简答题' },
  language: { 'zh-CN': '简体中文' },
  reviewStatus: { draft: '草稿', validating: '待校验', candidate: '候选', confirmed: '已确认', needsRevision: '需修订', archived: '已归档' },
  sourceStatus: { valid: '有效', stale: '需复核', missing: '来源缺失' },
  relationType: { supports: '支持' },
  knowledgeType: { concept: '概念', fact: '事实', principle: '原理', process: '流程', algorithm: '算法', formula: '公式', comparison: '对比', application: '应用' },
  sourceMode: { manual: '手动', annotation: '标注', selection: '选区', ai: 'AI 辅助', import: '导入' },
  status: { valid: '有效', invalid: '失效', insufficient: '来源不足', draft: '待整理', active: '有效', published: '已发布', archived: '已归档', stale: '需复核', ready: '可用', missing: '缺失', corrupt: '已损坏', failed: '失败', pending: '待处理', uploading: '上传中' },
  scopeType: { selection: '选中文字', blocks: '段落范围', section: '标题范围' },
  lifecycleStatus: { active: '有效', archived: '已取消' },
  anchorStatus: { resolved: '已定位', needsReview: '需要复核', missing: '原文缺失' },
  kind: { important: '重点', question: '疑问', supplement: '补充', pitfall: '易错', temporary: '临时' },
  importance: { normal: '一般', important: '重要', core: '核心' },
  anchorReason: { sourceDeleted: '原文已删除', projectionVersionMismatch: '正文解析版本变化', structureChanged: '正文结构变化', contentChanged: '正文内容变化', sectionDeleted: '标题范围已删除', boundaryChanged: '范围边界变化', ambiguousMatch: '存在多个匹配位置', sectionIdentityMissing: '缺少标题定位信息' },
  operation: { created: '创建', metadataUpdated: '修改标记信息', rangeChanged: '修改范围', archived: '取消标记', restored: '恢复标记', reanchored: '重新定位' }
};

export function entityTitle(item: EntityConflictItem): string {
  for (const value of [item.local, item.remote, item.base]) {
    const title = value?.title ?? value?.name ?? value?.objective ?? value?.stem ?? value?.description ?? value?.fileName ?? value?.originalName ?? value?.filename;
    if (typeof title === 'string' && title) return title;
  }
  return item.id;
}

export function entityPresence(value: EntityValue | SyncNote | null, base: EntityValue | SyncNote | null, baseline = false, collection = ''): string {
  if (value === null) return baseline ? '无共同基线' : base ? '已永久删除' : '不存在（无共同基线，无法判定是否曾删除）';
  if (value.deleted || (lifecycleCollections.has(collection) && value.deletedAt)) return '已移入回收站';
  return '存在';
}

const lifecycleCollections = new Set(['knowledgeItems', 'learningObjectives', 'examProfiles', 'examFocuses', 'questions']);
const trainingCollections = new Set(['learningObjectives', 'examProfiles', 'examFocuses', 'questions', 'questionObjectives', 'questionSources']);

export function includesTrainingAssets(items: EntityConflictItem[]): boolean { return items.some(item => trainingCollections.has(item.collection)); }

export function localAssetResolutionBlock(conflict: EntityConflict): string | undefined {
  const knowledge = conflict.items.filter(item => (lifecycleCollections.has(item.collection) || trainingCollections.has(item.collection)) && item.local);
  if (knowledge.some(item => !item.remote && (item.base || conflict.changedEpoch))) {
    return '云端资产已永久删除，不能采用本地恢复原编号。请采用云端版本；本地修改会保存在恢复记录中。';
  }
  // 以回收站基线发起的恢复是显式操作；旧活跃基线的编辑不能代替恢复。
  if (knowledge.some(item => item.remote?.deletedAt && !item.local?.deletedAt && !item.base?.deletedAt)) {
    return '云端资产已移入回收站，不能用本地旧编辑直接恢复。请先采用云端版本，将本地修改保存在恢复记录中，再从回收站显式恢复。';
  }
  return undefined;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
export function sameField(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right); }

export function entityFields(item: EntityConflictItem): string[] {
  return [...new Set([item.base, item.local, item.remote].flatMap(value => value ? Object.keys(value) : []))]
    .filter(key => !ignored.has(key))
    .sort((a, b) => Number(sameField(item.local?.[a], item.remote?.[a])) - Number(sameField(item.local?.[b], item.remote?.[b])));
}
export function fieldLabel(key: string): string { return fieldNames[key] ?? `其他字段（${key}）`; }

export function fieldValue(value: unknown, key: string, items: EntityConflictItem[], depth = 0, collection = '', sourceType?: unknown): string {
  if (value === undefined) return '未设置';
  if (value === null) return '空值';
  if (typeof value === 'boolean') return key === 'deleted' ? value ? '已移入回收站' : '正常' : key === 'favorite' ? value ? '已收藏' : '未收藏' : value ? '是' : '否';
  if (depth > 4) return '嵌套内容较多，请导出恢复记录查看完整内容';
  if (Array.isArray(value)) return value.length ? value.slice(0, 30).map(child => fieldValue(child, key, items, depth + 1, collection, sourceType)).join('；') + (value.length > 30 ? `；另有 ${value.length - 30} 项` : '') : '无';
  if (typeof value === 'object') return Object.entries(value).slice(0, 30).map(([childKey, child]) => `${fieldLabel(childKey)}：${fieldValue(child, childKey, items, depth + 1, collection, (value as EntityValue).sourceType ?? sourceType)}`).join('；');
  if (typeof value === 'string') {
    if (key === 'status' && collection === 'notes' && value === 'active') return '进行中';
    if (key === 'status' && collection === 'contentAnnotations' && value === 'archived') return '已取消';
    if (enumNames[key]?.[value]) return enumNames[key][value];
    const referenceCollection = key === 'sourceId' ? ({ learningObjective: 'learningObjectives', knowledgeItem: 'knowledgeItems', knowledgeEvidence: 'knowledgeEvidence', noteVersion: 'noteVersions', annotation: 'contentAnnotations' } as Record<string, string>)[String(sourceType)] : referenceCollections[key];
    const target = referenceCollection && items.find(item => item.collection === referenceCollection && item.id === value);
    if (target) return `${entityTitle(target)}（${value}）`;
    if (key.endsWith('At') && value && !Number.isNaN(Date.parse(value))) return new Date(value).toLocaleString('zh-CN');
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…（过长字段已截断，完整内容见恢复记录）` : value || '空文本';
  }
  return String(value);
}
