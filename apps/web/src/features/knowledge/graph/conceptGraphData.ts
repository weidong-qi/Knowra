// 概念图原型的手填数据。内容取自用户《动手学深度学习》第 1–2 章笔记，用于验证交互与模型假设；
// 不读写知识库，也不代表正式领域模型。掌握状态为手填示例，不是测评结果。

export type MasteryLevel = 'notAssessed' | 'weak' | 'basic' | 'mastered';
export type VerificationStatus = 'confirmed' | 'candidate' | 'disputed';
export type ItemKind = 'definition' | 'fact' | 'process' | 'application';
export type SemanticRelationType = 'isA' | 'partOf' | 'prerequisiteOf' | 'appliesTo' | 'contrastsWith' | 'relatedTo';
/** 研究视图专用：不是语义关系，而是实验过程留下的信号（检索、疑似重复、整理建议）。 */
export type ResearchRelationType = 'retrievedNotReused' | 'possibleDuplicate' | 'suggestDemote' | 'suggestMerge';
export type RelationType = SemanticRelationType | ResearchRelationType;
export type SuggestionAction = 'keep' | 'demote' | 'merge' | 'rename' | 'split';

export interface GraphConcept {
  id: string;
  name: string;
  /** 语境/义项说明：同名异义时靠它区分。 */
  sense: string;
  aliases: string[];
  x: number;
  y: number;
  /** 研究视图：概念来自哪篇笔记。 */
  noteId?: string;
  /** 研究视图：挂靠之后的整理建议，只展示，不执行。 */
  suggestion?: { action: SuggestionAction; summary: string; reason: string };
}

export interface GraphSource {
  note: string;
  quote: string;
}

export interface GraphSourceIssue extends GraphSource {
  issue: string;
}

export interface GraphItem {
  id: string;
  title: string;
  kind: ItemKind;
  statement: string;
  conceptIds: string[];
  verification: VerificationStatus;
  verificationNote?: string;
  mastery: MasteryLevel;
  source: GraphSource | null;
  /** 研究视图：保留全部原文出处与每条 AI 意见对应的原文，不将意见挂到首个来源。 */
  sources?: GraphSource[];
  sourceIssues?: GraphSourceIssue[];
  /** 研究视图：同一条目被几篇笔记引用。 */
  sourceCount?: number;
}

export interface GraphRelation {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  /** 连线上的短标签；不承载正文。 */
  label?: string;
  /** 需要说明的关系由唯一的知识条目承载，连线只负责画线（方案 B）。 */
  basisItemId?: string;
  /** 模型提议的关系一律是候选；手填示例不设置。 */
  verification?: VerificationStatus;
  /** 研究视图：提议或建议的理由。 */
  reason?: string;
}

export interface ConceptGraphData {
  /** 有值时是研究视图：说明数据从哪来、不会写入什么。 */
  notice?: string;
  concepts: GraphConcept[];
  items: GraphItem[];
  relations: GraphRelation[];
}

const NOTE_21 = '2.1 数据操作';
const NOTE_23 = '2.3 线性代数';
const NOTE_24 = '2.4 微积分';
const NOTE_25 = '2.5 自动微分';

export const CONCEPT_GRAPH_SAMPLE: ConceptGraphData = {
  concepts: [
    { id: 'tensor', name: '张量', sense: '深度学习框架中的多维数组', aliases: ['tensor'], x: 500, y: 150 },
    { id: 'vector', name: '向量', sense: '一维张量', aliases: ['vector'], x: 300, y: 290 },
    { id: 'matrix', name: '矩阵', sense: '二维张量', aliases: ['matrix'], x: 700, y: 290 },
    { id: 'dot', name: '点积', sense: '两个等长向量逐元素相乘再求和', aliases: ['dot product', '内积'], x: 160, y: 460 },
    { id: 'norm', name: '范数', sense: '衡量向量或矩阵“大小”的数', aliases: ['norm'], x: 330, y: 560 },
    { id: 'matmul', name: '矩阵乘法', sense: '矩阵与向量、矩阵与矩阵的乘积', aliases: ['矩阵-向量乘法', 'matmul'], x: 600, y: 480 },
    { id: 'gradient', name: '梯度', sense: '数学：多元函数偏导数组成的向量', aliases: ['gradient'], x: 850, y: 440 },
    { id: 'grad-attr', name: 'x.grad', sense: 'PyTorch：张量上存放梯度值的属性', aliases: ['.grad'], x: 950, y: 640 },
    { id: 'autograd', name: '自动微分', sense: '框架根据计算过程自动求梯度', aliases: ['autograd', '自动求导'], x: 680, y: 630 },
    { id: 'chain', name: '链式法则', sense: '复合函数求导规则', aliases: ['chain rule'], x: 500, y: 640 }
  ],
  items: [
    { id: 'tensor-def', title: '张量的定义', kind: 'definition', statement: '张量是多维数组。', conceptIds: ['tensor'], verification: 'confirmed', mastery: 'mastered', source: { note: NOTE_21, quote: '张量：多维数组' } },
    { id: 'tensor-dims', title: '张量的维度', kind: 'fact', statement: '张量的维度指它有几个轴。', conceptIds: ['tensor'], verification: 'confirmed', mastery: 'basic', source: { note: NOTE_23, quote: '张量的维度：表示该张量轴的个数' } },
    { id: 'tensor-reduce', title: '沿轴降维', kind: 'process', statement: '用 a.sum(axis=0) 沿某个轴求和，该轴消失；传入 keepdims=True 可保留该轴。', conceptIds: ['tensor'], verification: 'candidate', mastery: 'notAssessed', source: { note: NOTE_23, quote: '沿哪个轴降维，哪个轴就消失' } },
    { id: 'vector-def', title: '向量是一维张量', kind: 'definition', statement: '向量是一维张量；标量是零维张量。', conceptIds: ['vector', 'tensor'], verification: 'confirmed', mastery: 'mastered', source: { note: NOTE_21, quote: '标量：0维张量；向量：1维张量' } },
    { id: 'vector-dims', title: '向量的维度 ≠ 张量的维度', kind: 'fact', statement: '向量的维度指元素个数；张量的维度指轴的个数，两者含义不同。', conceptIds: ['vector', 'tensor'], verification: 'confirmed', mastery: 'weak', source: { note: NOTE_23, quote: '向量/轴的维度：表示该向量/轴的元素个数' } },
    { id: 'matrix-def', title: '矩阵是二维张量', kind: 'definition', statement: '矩阵是二维张量。', conceptIds: ['matrix', 'tensor'], verification: 'confirmed', mastery: 'mastered', source: { note: NOTE_21, quote: '矩阵：2维张量' } },
    { id: 'matrix-transpose', title: '矩阵转置', kind: 'process', statement: '用 A.T 得到矩阵 A 的转置。', conceptIds: ['matrix'], verification: 'confirmed', mastery: 'notAssessed', source: { note: NOTE_23, quote: 'A.T' } },
    { id: 'dot-def', title: '点积的计算', kind: 'definition', statement: '两个等长向量逐元素相乘后再求和，可用 torch.dot(x, y) 或 torch.sum(x * y)。', conceptIds: ['dot', 'vector'], verification: 'confirmed', mastery: 'basic', source: { note: NOTE_23, quote: '向量点积就是逐元素相乘后再求和' } },
    { id: 'dot-inner', title: '点积与内积的说法', kind: 'fact', statement: '点积是两个等长向量之间的概念，张量之间叫内积。', conceptIds: ['dot', 'tensor'], verification: 'disputed', verificationNote: '笔记原话，表述不够准确：内积是点积在一般向量空间上的推广，并不专指张量之间的运算。保留原话，待核查后修订。', mastery: 'notAssessed', source: { note: NOTE_23, quote: '注意：点积是两个等长向量之间的概念，张量之间叫内积' } },
    { id: 'norm-def', title: '范数的含义', kind: 'definition', statement: '范数用一个数表示向量或矩阵有多大。', conceptIds: ['norm'], verification: 'confirmed', mastery: 'basic', source: { note: NOTE_23, quote: '范数就是用一个数来表示向量/矩阵有多大' } },
    { id: 'norm-l1', title: 'L1 范数', kind: 'fact', statement: 'L1 范数是所有元素绝对值之和，可用 torch.abs(u).sum() 计算。', conceptIds: ['norm', 'vector'], verification: 'confirmed', mastery: 'notAssessed', source: { note: NOTE_23, quote: 'L1范数：所有元素绝对值相加' } },
    { id: 'norm-l2', title: 'L2 范数', kind: 'fact', statement: 'L2 范数是元素平方和再开根号，即向量的欧几里得长度，可用 torch.norm(x) 计算。', conceptIds: ['norm', 'vector'], verification: 'confirmed', mastery: 'weak', source: { note: NOTE_23, quote: 'L2范数：平方和再开根号，即向量的欧几里得长度（距离）' } },
    { id: 'matmul-mv', title: '矩阵-向量乘法', kind: 'process', statement: '用 torch.mv(A, x) 计算矩阵与向量的乘积。', conceptIds: ['matmul', 'matrix', 'vector'], verification: 'confirmed', mastery: 'basic', source: { note: NOTE_23, quote: 'torch.mv(A, x)' } },
    { id: 'matmul-mm', title: '矩阵-矩阵乘法', kind: 'process', statement: '用 torch.mm(A, B) 计算两个矩阵的乘积。', conceptIds: ['matmul', 'matrix'], verification: 'confirmed', mastery: 'notAssessed', source: { note: NOTE_23, quote: 'torch.mm(A, B)' } },
    { id: 'matmul-shape', title: '矩阵乘法的形状要求', kind: 'fact', statement: 'A 的列数必须等于 B 的行数，A 为 m×n、B 为 n×p 时结果为 m×p。', conceptIds: ['matmul', 'matrix'], verification: 'candidate', verificationNote: '笔记里没有写到，由 AI 补充，尚未确认。', mastery: 'notAssessed', source: null },
    { id: 'matmul-dot', title: '矩阵-向量乘法由点积组成', kind: 'fact', statement: '结果向量的第 i 个元素，是矩阵第 i 行与该向量的点积。', conceptIds: ['matmul', 'dot'], verification: 'candidate', verificationNote: '笔记里没有写到，由 AI 补充，尚未确认。', mastery: 'notAssessed', source: null },
    { id: 'gradient-def', title: '梯度的定义', kind: 'definition', statement: '多变量函数对各个变量的偏导数组成的向量。', conceptIds: ['gradient'], verification: 'confirmed', mastery: 'basic', source: { note: NOTE_24, quote: '梯度 = 多变量情况下，各个变量方向的变化率（偏导数值）组成的向量' } },
    { id: 'gradient-direction', title: '梯度的方向', kind: 'fact', statement: '梯度指向函数上升最快的方向。', conceptIds: ['gradient'], verification: 'confirmed', mastery: 'mastered', source: { note: NOTE_24, quote: '且梯度指向函数上升最快的方向' } },
    { id: 'grad-vs-attr', title: '梯度与 x.grad 的区别', kind: 'fact', statement: '数学上的梯度是一个向量；x.grad 是 PyTorch 在张量上存放这个梯度值的属性，二者相关但不是同一个概念。', conceptIds: ['gradient', 'grad-attr'], verification: 'candidate', verificationNote: '为演示同名异义而补充，尚未确认。', mastery: 'notAssessed', source: null },
    { id: 'grad-accumulate', title: '梯度会累积', kind: 'fact', statement: 'PyTorch 的梯度会累积，重新求导前要用 x.grad.zero_() 清零。', conceptIds: ['grad-attr'], verification: 'confirmed', mastery: 'weak', source: { note: NOTE_25, quote: '因为Pytorch的梯度是累积的，所以要清零' } },
    { id: 'grad-requires', title: '开启梯度存储', kind: 'process', statement: '调用 x.requires_grad_(True)，告诉 PyTorch 需要对 x 求导，并为梯度分配存储。', conceptIds: ['grad-attr', 'autograd'], verification: 'confirmed', mastery: 'basic', source: { note: NOTE_25, quote: '这一步是告诉pytorch，我们要对x进行求导/求梯度，需要帮我们找一个地方存储梯度' } },
    { id: 'autograd-flow', title: '求梯度的主线', kind: 'process', statement: 'x.requires_grad_(True) → 用 x 计算 y → y.backward() → 读取 x.grad。', conceptIds: ['autograd', 'grad-attr'], verification: 'confirmed', mastery: 'mastered', source: { note: NOTE_25, quote: 'y.backward()' } },
    { id: 'autograd-vector', title: '非标量输出求梯度', kind: 'process', statement: 'y 是向量时，先 y.sum() 得到标量，再调用 backward()。', conceptIds: ['autograd'], verification: 'confirmed', mastery: 'weak', source: { note: NOTE_25, quote: 'y.sum().backward()' } },
    { id: 'autograd-detach', title: '分离计算', kind: 'process', statement: 'u = y.detach() 让 u 与 y 取值相同，但求梯度时把它视为常数。', conceptIds: ['autograd'], verification: 'confirmed', mastery: 'notAssessed', source: { note: NOTE_25, quote: 'u = y.detach()' } }
  ],
  relations: [
    { id: 'r-vector-tensor', from: 'vector', to: 'tensor', type: 'isA', basisItemId: 'vector-def' },
    { id: 'r-matrix-tensor', from: 'matrix', to: 'tensor', type: 'isA', basisItemId: 'matrix-def' },
    { id: 'r-dot-vector', from: 'dot', to: 'vector', type: 'relatedTo', label: '作用于' },
    { id: 'r-norm-vector', from: 'norm', to: 'vector', type: 'relatedTo', label: '度量' },
    { id: 'r-matmul-matrix', from: 'matmul', to: 'matrix', type: 'relatedTo', label: '作用于' },
    { id: 'r-dot-matmul', from: 'dot', to: 'matmul', type: 'prerequisiteOf', basisItemId: 'matmul-dot' },
    { id: 'r-gradient-attr', from: 'gradient', to: 'grad-attr', type: 'contrastsWith', label: '同名易混', basisItemId: 'grad-vs-attr' },
    { id: 'r-gradient-autograd', from: 'gradient', to: 'autograd', type: 'prerequisiteOf' },
    { id: 'r-autograd-attr', from: 'autograd', to: 'grad-attr', type: 'relatedTo', label: '结果写入' },
    { id: 'r-autograd-chain', from: 'autograd', to: 'chain', type: 'appliesTo' }
  ]
};
