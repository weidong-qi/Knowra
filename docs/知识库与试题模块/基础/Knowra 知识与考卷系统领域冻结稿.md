# Knowra 知识与考卷系统领域冻结稿

> 文档状态：核心方案冻结草案
> 适用范围：知识提炼、知识管理、训练出题、作答批改、掌握评估与复习闭环
> 当前前提：项目已经具备 Markdown 笔记编辑能力，后续功能必须建立在现有笔记系统之上
> 生命周期补充：资产的归档、移入回收站、恢复与受控永久删除，以较新的[资产生命周期规范 v1.0](../../Knowra_资产生命周期规范_v1.0.md)为准；本文早期的状态字段只保留其原阶段语义。

---

# 1. 产品定位

Knowra 不是单纯的笔记软件，也不是只提供 RAG 问答的知识库。

Knowra 的核心目标是：

> 将原始学习资料转化为结构化、可追溯、可评测的知识，并根据真实学习证据持续安排后续训练与复习。

系统主闭环固定为：

```text id="7km9fg"
资料与笔记
→ 提炼知识
→ 定义学习目标
→ 生成练习或试卷
→ 用户作答
→ 批改
→ 生成学习证据
→ 更新掌握状态
→ 安排复习
→ 再次训练
```

原总结中“资料—知识—训练—成长”的整体方向继续保留，但 RAG、知识图谱和 AI 任务不再被视作闭环中的独立步骤，而作为横向基础能力。

---

# 2. 核心设计结论

以下结论作为后续设计与开发的稳定基础。

## 2.1 笔记与知识分离

笔记保存完整原文和上下文。

知识点保存经过提炼和确认后的知识语义。

```text id="rtkry8"
Note ≠ KnowledgeItem
```

一篇《Transformer 学习讲义》是资料。

“Self-Attention 的计算过程”是知识点。

---

## 2.2 标注不是知识点的必经前置

用户可以通过以下方式产生知识候选：

```text id="zx5jud"
正文标注
当前选区
当前章节
整篇笔记
手动创建
已有知识合并或拆分
错题分析
外部资料导入
```

因此：

```text id="rhkicf"
Annotation → KnowledgeItem
```

只是一条常见路径，不是强制关系。

---

## 2.3 知识点与学习目标分离

### KnowledgeItem

回答：

> 这是什么知识？

### LearningObjective

回答：

> 学习者需要能够做什么？

例如：

```text id="i2f6cu"
知识点：
TCP 通过三次报文交换建立连接并同步初始序列号。

学习目标：
1. 能描述三次握手的报文顺序。
2. 能解释为什么两次握手不充分。
3. 能根据报文标志位判断连接建立阶段。
```

知识点是知识管理中心。

学习目标是训练与评测中心。

---

## 2.4 通用学习目标与考试考点分离

学习目标不依赖某个具体考试。

考试考点是在特定考试语境下，对学习目标进行选择、加权或具体化。

```text id="rvqiyf"
KnowledgeItem
→ LearningObjective
→ ExamFocus
→ Question
```

其中 `ExamFocus` 为可选对象。

没有具体考试目标时，可以直接根据 LearningObjective 生成普通练习。

---

## 2.5 掌握度不属于知识点本身

掌握状态不是知识定义的一部分，而是：

```text id="05bdmn"
某个用户
对某个学习目标
基于若干学习证据
形成的能力估计
```

因此不能直接在 KnowledgeItem 中保存一个简单的 `mastery = 70%`。

应当保存：

```text id="xa1jvh"
LearningEvidence
MasteryState
```

并由多个学习目标的状态聚合出知识点总体状态。

---

## 2.6 RAG 不是正式知识库

RAG 索引是可以重新生成的派生数据。

正式数据包括：

```text id="uq4qmm"
笔记
知识点
学习目标
知识关系
题目
作答记录
学习证据
```

检索数据包括：

```text id="gw3ra8"
DocumentChunk
KeywordIndex
EmbeddingRecord
```

向量数据损坏后应可以重新建立，不能作为知识唯一真源。

---

## 2.7 知识图谱不是另一套数据

知识图谱由以下正式数据投影产生：

```text id="phcm64"
KnowledgeConcept
+
KnowledgeConceptLink
+
KnowledgeConceptRelation
```

图谱只是一种呈现和探索方式。

不得在图谱模块中重新维护另一份独立的知识节点和关系。

---

# 3. 核心领域对象

第一阶段冻结以下核心对象。

---

## 3.1 Note：笔记

职责：

- 保存 Markdown 正文；
- 保存标题、文件夹、标签和附件关系；
- 作为知识来源；
- 提供 AI 分析范围。

建议核心字段：

```text id="hsv40q"
id
title
content
folderId
contentHash
createdAt
updatedAt
deletedAt
```

---

## 3.2 NoteVersion：笔记版本

职责：

- 保存可追溯的正文版本；
- 保证知识来源、题目和 AI 结果可以追溯到生成时的内容；
- 支持来源失效检测。

建议字段：

```text id="bw4zdk"
id
noteId
content
contentHash
createdAt
createdBy
```

不要求每次输入都产生版本。

可以在以下场景生成：

```text id="6mjjqx"
用户主动保存
AI 分析开始前
生成正式题目或试卷前
正文发生较大修改
系统恢复点
```

---

## 3.3 Annotation：笔记标注

职责：

> 表达用户认为某段内容值得关注。

标注可以是：

```text id="6e3pbz"
重点
疑问
补充
易错
临时笔记
```

建议字段：

```text id="ldgnuc"
id
noteId
noteVersionId
annotationType
selectedText
headingPath
startOffset
endOffset
prefixText
suffixText
contentHash
status
createdAt
updatedAt
```

状态：

```text id="zrm49d"
active
stale
archived
```

标注不是正式知识。

删除标注不得自动删除由它产生的知识点。

---

## 3.4 AnalysisScope：AI 分析范围

AnalysisScope 主要是运行时输入，不一定长期保存。

可选范围：

```text id="da5jcv"
selection
heading
note
folder
knowledgeItems
```

它与 Annotation 的区别是：

- Annotation 是用户希望留下的持久数据；
- AnalysisScope 只是本次 AI 操作选择的处理范围。

---

## 3.5 KnowledgeTopic：知识主题

职责：

- 按课程、学科或主题组织知识；
- 提供树形目录；
- 帮助筛选与导航。

例如：

```text id="n3h2ue"
计算机网络
└── 传输层
    └── TCP
```

主题主要负责组织，不必具有独立的知识陈述。

一个知识点可以属于多个主题。

---

## 3.6 KnowledgeItem：知识点

职责：

> 表达一个相对稳定、可以独立理解的知识语义单元。

建议字段：

```text id="gnj4e3"
id
title
canonicalStatement
userExplanation
knowledgeType
importance
reviewStatus
sourceMode
createdAt
updatedAt
deletedAt
```

### canonicalStatement

必须表达知识本身，不能只保存标题。

### userExplanation

保存用户自己的理解，可为空。

### knowledgeType

第一版建议：

```text id="2a8hak"
concept
fact
principle
process
algorithm
formula
comparison
application
```

### reviewStatus

```text id="a31mmb"
candidate
confirmed
needsRevision
archived
```

AI 生成的 KnowledgeItem 默认是 `candidate`。

---

## 3.7 KnowledgeEvidence：知识来源关系

职责：

> 说明知识点依据什么资料产生。

建议字段：

```text id="g54uk9"
id
knowledgeItemId
sourceType
sourceId
noteId
noteVersionId
quoteText
headingPath
relationType
createdAt
```

关系类型第一版可以只实现：

```text id="lpzvm8"
supports
```

后期再扩展：

```text id="39oxmp"
example
exception
comparison
```

关系必须支持：

```text id="otz4bd"
一个来源 → 多个知识点
多个来源 → 一个知识点
```

---

## 3.8 概念身份、挂靠与概念关系

2026-11-12 修订：概念身份独立于知识陈述；原先连接知识点并自带说明的 KnowledgeRelation 由以下三类正式对象取代。已有 KnowledgeItem、LearningObjective 字段不变，旧 concept 类型知识点不自动迁移。

### KnowledgeConcept：概念

只保存名称、区分标签、别名、审阅状态、来源方式、关注状态与必要的版本/删除信息，不保存知识正文。同名或别名重叠的概念须用不同且非空的区分标签消歧。

用户手工新建为 confirmed。归档与不关注不改变身份。合并用于同一概念的重复身份：事务内迁移关联与关系、去重，源名称收为目标别名，源概念停用；不提供撤销合并，不在读取时追踪合并链。

### KnowledgeConceptLink：知识点与概念的挂靠

一条知识点可关联多个概念，角色为 subject（主体：这条知识讲的是它）或 mentions（提及：这条知识用到了它）。挂靠只保存身份和角色，不复制正文。

知识点进入回收站时保留挂靠，展示过滤；恢复后重新出现。永久删除知识点时，同一事务软删除挂靠及以其为依据的概念关系，预览列明数量。

### KnowledgeConceptRelation：概念关系

关系连接两个不同的有效概念，类型为 partOf、prerequisiteOf、contrastsWith、causes、appliesTo、relatedTo、isA；contrastsWith、relatedTo 不分方向。

关系不保存说明正文。解释写入 KnowledgeItem，以 basisItemId 指向该知识点；依据知识点必须同时挂靠关系两端。只有用户手工绘制的骨架边允许没有依据。AI 产物保持 candidate，公开手工命令不得自称 AI 来源。

解除或移动挂靠导致关系依据失效时，弹窗说明将删除的关系；确认一次，在同一事务完成关联变更及关系软删除。服务端重新核对确认范围，变化时拒绝执行。

第一期实现三类对象的存储、校验、同步及手工概念/挂靠界面；关系编辑与真实概念图在第二期开放。具体契约见[概念层首版开发方案](../概念层首版-开发方案.md)。

---

## 3.9 LearningObjective：学习目标

职责：

> 定义一个可以被观察、训练和评测的能力。

建议字段：

```text id="fzi9fh"
id
knowledgeItemId
objective
actionVerb
cognitiveLevel
difficultyHint
reviewStatus
order
createdAt
updatedAt
```

示例：

```text id="4foicj"
能够解释为什么 load-use hazard 即使存在转发仍需要停顿。
```

不允许使用：

```text id="m6ocma"
了解 TCP
熟悉 Prim
掌握流水线
```

因为这些描述无法直接评测。

### cognitiveLevel

第一版建议：

```text id="f55ah7"
remember
understand
apply
analyze
```

---

## 3.10 ExamProfile：考试配置

职责：

> 描述一个具体考试或训练场景。

建议字段：

```text id="3o99h3"
id
name
description
scope
language
commonQuestionTypes
difficultyProfile
createdAt
updatedAt
```

例如：

```text id="5eo96v"
408 计算机网络
大阪大学 IST 专业课
日常概念复习
考前综合检测
```

---

## 3.11 ExamFocus：考试考点

职责：

> 表达某个学习目标在指定考试中的考查倾向。

建议字段：

```text id="llkcjv"
id
examProfileId
learningObjectiveId
description
priority
difficultyHint
questionTypeSuggestions
sourceType
reviewStatus
createdAt
updatedAt
```

来源可以是：

```text id="y04jbr"
manual
ai
pastPaper
syllabus
```

ExamFocus 不要求永久存在。

临时练习可以直接使用 LearningObjective。

---

## 3.12 Question：题目

职责：

> 对一个或多个学习目标实施评测。

建议核心字段：

```text id="m41cgp"
id
questionType
stem
options
referenceAnswer
explanation
difficulty
reviewStatus
sourceMode
version
createdAt
updatedAt
```

题目通过中间关系关联学习目标：

```text id="4eohiu"
Question
↕
QuestionObjective
↕
LearningObjective
```

一题可以考查多个目标。

一个目标也可以对应多道题。

---

## 3.13 QuestionSource：题目来源

职责：

- 保存生成题目的原始依据；
- 支持标准答案验证；
- 支持用户查看引用。

题目不能只记录“由 AI 生成”，还应知道使用了哪些知识点、笔记片段或历年试题。

---

## 3.14 ExamBlueprint：试卷蓝图

职责：

> 在正式组卷前定义试卷应当怎样覆盖知识与能力。

建议字段：

```text id="67le89"
id
title
scope
examProfileId
questionTypeDistribution
difficultyDistribution
objectiveCoverage
questionCount
totalScore
timeLimit
newQuestionRatio
mistakeReviewRatio
createdAt
updatedAt
```

试卷不是简单的“生成十道题”。

应先确定蓝图，再选择已有题目或补充生成新题。

---

## 3.15 Exam：试卷

职责：

- 保存正式试卷；
- 保存题目顺序、分值和版本；
- 保存发布后的稳定快照。

正式试卷应使用：

```text id="5cnrui"
ExamQuestionSnapshot
```

即使原题后来被修改，历史试卷内容也不得变化。

---

## 3.16 Attempt：一次训练过程

职责：

> 表示用户完成的一次练习或考试。

建议字段：

```text id="tzvyf0"
id
attemptType
examId
status
startedAt
submittedAt
completedAt
```

attemptType：

```text id="75zhpb"
quickPractice
formalExam
review
mistakeRetry
```

---

## 3.17 Response：单题作答

职责：

- 保存用户答案；
- 保存是否使用提示；
- 保存答题时间和提交状态。

建议字段：

```text id="vrywbt"
id
attemptId
questionSnapshotId
userAnswer
usedHint
viewedReference
answeredAt
```

---

## 3.18 GradeResult：批改结果

职责：

> 保存一道题的批改结果，而不是直接修改掌握度。

建议字段：

```text id="lwfk0r"
id
responseId
score
maxScore
rubricResults
correctParts
missingParts
incorrectParts
errorTypes
feedback
confidence
graderType
model
promptVersion
reviewStatus
createdAt
```

graderType：

```text id="53mv5p"
deterministic
ai
manual
hybrid
```

---

## 3.19 LearningEvidence：学习证据

职责：

> 将作答结果转化为可用于掌握度估计的证据。

建议字段：

```text id="gpwdb6"
id
userId
learningObjectiveId
sourceType
sourceId
result
scoreRatio
difficulty
usedHint
viewedReference
evidenceWeight
occurredAt
```

不是所有题目的证据权重都相同。

例如：

- 看过答案后答对；
- 蒙对一道选择题；
- 独立完成综合题；

这三者不能被视为相同程度的掌握证据。

---

## 3.20 MasteryState：掌握状态

职责：

> 表示系统当前对用户能力的估计。

建议按以下组合保存：

```text id="432ayl"
userId + learningObjectiveId
```

建议字段：

```text id="ybk6zn"
masteryScore
confidence
evidenceCount
objectiveCoverage
status
lastAssessedAt
nextReviewAt
updatedAt
```

用户可见状态：

```text id="valjah"
notAssessed
learning
basic
mastered
weak
dueForReview
```

`masteryScore` 的具体计算公式暂不冻结。

第一版可以采用简单、可解释的规则，后期再替换为更成熟的模型。

---

## 3.21 SelfAssessment：主观掌握判断

职责：

> 保存用户自己对知识的感受。

例如：

```text id="6jxavx"
没学过
有印象
不太理解
感觉掌握
```

SelfAssessment 与 MasteryState 必须分开。

用户觉得“我会了”，不等于系统已经有足够证据。

系统判断“证据不足”，也不意味着否定用户感受。

---

## 3.22 Misconception：错误认知候选

职责：

> 表示用户可能存在的稳定误解。

例如：

```text id="w2ml99"
误认为 load 的结果可以在 MEM 阶段开始时立刻供下一条指令使用。
```

Misconception 必须是候选分析结果。

一次答错不能直接生成永久误区。

建议状态：

```text id="ibab9f"
candidate
confirmed
resolved
dismissed
```

---

## 3.23 ReviewSchedule：复习安排

职责：

> 根据掌握状态、遗忘风险和错误记录安排后续复习。

建议字段：

```text id="r4dfpq"
id
userId
learningObjectiveId
reviewType
scheduledAt
priority
reason
status
createdAt
completedAt
```

reviewType：

```text id="om12cz"
knowledgeReview
questionRetry
variantPractice
selfRecall
```

---

# 4. 对象关系冻结

核心关系如下：

```text id="sk0eco"
Note
├── NoteVersion
└── Annotation

KnowledgeTopic
↕
KnowledgeItem
├── KnowledgeEvidence ─→ Note / Annotation / ExternalSource
├── KnowledgeConceptLink ─→ KnowledgeConcept
│                              └── KnowledgeConceptRelation ─→ KnowledgeConcept
└── LearningObjective
        ├── ExamFocus ─→ ExamProfile
        ├── QuestionObjective ─→ Question
        └── LearningEvidence
                └── MasteryState
```

训练关系：

```text id="19z9js"
ExamBlueprint
→ Exam
→ ExamQuestionSnapshot
→ Attempt
→ Response
→ GradeResult
→ LearningEvidence
→ MasteryState
→ ReviewSchedule
```

---

# 5. 核心状态流转

## 5.1 知识点状态

```text id="md767p"
candidate
→ confirmed
→ needsRevision
→ confirmed
→ archived
```

AI 生成默认进入：

```text id="k1dt0a"
candidate
```

---

## 5.2 学习目标状态

```text id="z9qkxz"
candidate
→ confirmed
→ archived
```

未确认的学习目标不得进入正式出题范围。

---

## 5.3 题目状态

```text id="wu9n29"
draft
→ validating
→ candidate
→ confirmed
→ archived
```

临时练习题可以不进入完整状态流。

正式题库题必须经过结构校验。

---

## 5.4 AI 任务状态

```text id="0cyjg3"
pending
→ running
→ succeeded
```

异常路径：

```text id="8n0dut"
pending / running
→ failed
→ retrying
→ succeeded / failed
```

---

## 5.5 来源状态

```text id="ivboit"
active
→ stale
→ reanchored
```

无法重新定位时保持 `stale`，不得自动跳转到低置信度位置。

2026-09-28 兼容说明：以上为旧状态投影。当前标注分别保存阅读生命周期、定位健康（resolved／needsReview／missing）与关联知识来源健康。正文编辑不自动取消重点；定位可靠时按选区／块／章节动态跟随规则保持标注。内容变更可要求知识复核，但不得改写历史 Evidence 或分析快照；以功能需求文档 FR-M01—FR-M07 及动态跟随补充规则为准。

---

# 6. 模块边界冻结

推荐继续使用模块化单体。

## Note Module

负责：

```text id="1x6zi8"
Note
NoteVersion
Annotation
SourceAnchor
```

---

## Knowledge Module

负责：

```text id="98yyxf"
KnowledgeTopic
KnowledgeItem
KnowledgeEvidence
KnowledgeConcept
KnowledgeConceptLink
KnowledgeConceptRelation
LearningObjective
```

---

## Assessment Module

负责：

```text id="pq7zcr"
ExamProfile
ExamFocus
Question
ExamBlueprint
Exam
Attempt
Response
```

---

## Grading Module

负责：

```text id="o4xs9i"
确定性批改
AI Rubric 批改
人工复核
GradeResult
```

---

## Learning Module

负责：

```text id="39fpgx"
LearningEvidence
MasteryState
SelfAssessment
Misconception
ReviewSchedule
```

---

## Retrieval Module

负责：

```text id="i7oxt3"
DocumentChunk
关键词检索
向量检索
混合检索
Citation
```

Retrieval Module 不修改 Knowledge Module 的正式数据。

---

## AI Module

负责：

```text id="371elr"
AIJob
PromptVersion
ProviderGateway
StructuredOutputValidator
```

其他业务模块不得直接调用具体模型供应商。

## 后端模块边界与前端工作域

本节定义的是后端代码、事务和领域职责边界，不要求前端一级导航与后端模块一一对应。

前端一级工作域冻结为：

```text
01 资料
02 知识
03 训练
04 学习档案
```

映射关系如下：

| 前端工作域 | 主要职责 | 主要后端模块 |
| --- | --- | --- |
| 资料 | 保存、编辑和追溯原始资料 | Note Module |
| 知识 | 提炼、确认和组织知识及可评测目标 | Knowledge Module |
| 训练 | 题目资产、组卷、作答、批改和结果 | Assessment Module + Grading Module |
| 学习档案 | 掌握、薄弱、错误认知、复习安排和学习记录 | Learning Module |

全局工作台是四个工作域的聚合入口，不是第五个业务域。

`Retrieval Module` 与 `AI Module` 是横向基础能力，不作为独立一级工作域。它们通过当前资料、知识、训练或学习上下文提供检索、生成、批改和建议能力。知识图谱属于知识工作域中的关系视图，不得成为另一套知识管理入口。

前端可以为了用户任务组合多个后端模块的只读或应用服务能力，但不得因此改变本节冻结的领域职责、事务边界和正式数据真源。

---

# 7. 第一版 MVP 冻结范围

这里的“第一版”指产品形成首个完整学习闭环时的 MVP 完成目标，不等于单个工程阶段，也不要求所有对象和页面在同一版本一次交付。允许先建立人工创建、人工确认和可追溯资产管理，再接入 AI、作答、批改和掌握度。

第一版只实现：

```text id="h8ztrz"
笔记
→ 选区、章节或整篇分析
→ AI 生成知识候选
→ 用户确认
→ 生成学习目标
→ 选择知识点进行快速练习
→ 作答
→ 基础批改
→ 生成简单学习证据
→ 显示薄弱知识
→ 返回原文复习
```

## 第一版需要实现的对象

```text id="46mt0q"
NoteVersion
Annotation
KnowledgeItem
KnowledgeEvidence
LearningObjective
Question
Attempt
Response
GradeResult
LearningEvidence
简化版 MasteryState
AIJob
```

## 第一版暂不实现

```text id="vi687c"
复杂 ExamProfile
历年试题自动分析
完整正式题库
复杂 ExamBlueprint
大型自动组卷
全局知识图谱
Graph RAG
复杂遗忘曲线
自适应测试
多 Agent 自动学习
复杂掌握度算法
```

---

# 8. 第一版页面范围

页面按用户学习闭环划分为四个工作域。页面分组不改变第 6 节的后端模块边界。

## 资料工作域

保留现有三栏结构。

右侧辅助区：

```text id="f7g5up"
信息
大纲
标注
知识
AI
```

主要操作：

```text id="7jqcsl"
标记重点
提炼选区
分析当前章节
分析本篇笔记
根据本篇快速练习
```

完整的知识、学习目标和题目管理应进入对应独立工作域；资料右侧栏只保留与当前资料有关的候选入口、摘要、状态和回链。

---

## 知识工作域

第一版提供：

```text id="1o14cm"
知识概览
候选知识
已确认知识
知识详情
来源回链
学习目标
审核队列
简单筛选
```

暂不优先做知识图谱。

---

## 训练工作域

第一版提供：

```text id="c5n70m"
题目库与题目编辑
考试或训练场景
选择知识范围
配置题型与数量
生成快速练习
在线答题
查看批改结果
```

题目库是训练工作域中的资产管理页面，不作为独立一级工作域。

---

## 学习档案工作域

只有在 `LearningEvidence` 和简化版 `MasteryState` 已具备真实数据后才开放：

```text
今日复习
掌握状态
薄弱知识
错误认知
复习安排
学习记录
自我评估
```

不得用题目数量、用户自评或前端临时统计伪造系统掌握状态。

---

## 全局工作台与横向 AI

全局工作台在四个工作域产生足够真实数据后提供最近资料、待确认知识、待复核题目、未完成训练、薄弱目标和今日复习的聚合入口。

AI、RAG 和全局搜索不占用一级工作域：

- AI 操作出现在资料提炼、知识审核、训练生成、批改和复习建议等上下文中；
- RAG 只提供带真实引用的检索结果，不提供独立的正式知识编辑入口；
- 长任务通过 `AIJob` 展示进度、失败和重试状态；
- AI 生成的知识、目标、题目和关系仍遵守候选、来源和人工确认规则。

---

# 9. 必须遵守的领域规则

1. AI 生成的正式知识资产必须先进入候选态。
2. KnowledgeItem 正式确认时必须拥有标题和核心陈述。
3. 正式知识点应具有至少一个来源；纯手动知识需要明确标记。
4. LearningObjective 必须包含可评测动作。
5. 未确认目标不得进入正式出题范围。
6. Question 必须关联至少一个学习目标。
7. 正式题目必须保存标准答案或评分规则。
8. 正式试卷必须保存题目快照。
9. GradeResult 不得直接修改 KnowledgeItem。
10. 掌握状态只能由 LearningEvidence 更新。
11. SelfAssessment 不得覆盖系统 MasteryState。
12. 删除 Annotation 不得自动删除 KnowledgeItem。
13. 删除 Note 后，相关来源进入失效或来源不足状态。
14. 删除 Question 不得改变历史试卷。
15. RAG 结果必须带真实来源引用。
16. 低置信度 AI 批改必须允许用户复核。
17. 知识图谱只读取正式知识关系，不维护独立节点。
18. 外部 AI 调用不得放在数据库事务中。
19. 同一 AI 请求必须考虑幂等，避免重复生成候选。
20. 笔记修改后必须重新检查知识来源位置。

---

# 10. 暂不冻结的内容

以下内容需要通过实际使用验证后再决定。

## 掌握度公式

暂不确定：

- 每次答题影响多少；
- 时间衰减速度；
- 难度权重；
- 提示与查看答案的扣减比例。

第一版只使用简单、可解释的规则。

---

## 知识点最佳粒度

只冻结判断原则，不冻结字数或长度。

原则：

> 一个知识点应表达一个可以独立理解，并能够产生至少一个学习目标的知识语义单元。

---

## 完整知识关系类型

第一版只实现六类基础关系。

后续根据真实需求扩展，不预先穷举。

---

## 图谱布局

暂不冻结：

- 思维导图；
- 力导向图；
- 树图；
- 时间演化图。

先保证关系数据正确，再决定视觉形式。

---

## 向量模型与切片参数

暂不冻结：

- embedding 模型；
- 向量维度；
- chunk 大小；
- overlap；
- reranker。

这些属于 Retrieval Module 实现配置，不应污染领域模型。

---

# 11. 最终领域定义

```text id="rs2kr1"
笔记负责保存来源
标注负责表达阅读关注
知识主题负责组织
知识点负责表达知识
知识关系负责连接知识
学习目标负责定义能力
考试考点负责适配考试场景
题目负责执行评测
作答负责记录用户表现
批改负责解释作答结果
学习证据负责支撑能力判断
掌握状态负责估计当前水平
复习计划负责决定下一步学习
RAG 负责找到正确材料
知识图谱负责呈现知识连接
AI 负责辅助生成，不负责替用户确认长期事实
```

最终产品定义：

> **Knowra 是一个以可追溯知识和学习目标为基础，通过题目、批改与学习证据持续调整个人训练和复习的 AI 学习系统。**
