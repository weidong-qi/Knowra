import { useEffect, useRef } from 'react';
import type { KnowledgeItem, TrainingAssetRecord } from '@study-accelerator/web-core';
import { Button } from '../../components/ui';
import { MathText } from '../../components/math/MathText';
import { choiceAnswer, choiceOptions, difficultyLabel, questionSources, questionTypeLabel, reviewLabel, sourceStatusLabel, sourceTypeLabel, textValue, type QuestionSource } from './questionDetailModel';
import { QuestionValue } from './QuestionValue';
import styles from './QuestionDetailPanel.module.css';

const LEVELS: Record<string, string> = { remember: '记忆', understand: '理解', apply: '应用', analyze: '分析', evaluate: '评价', create: '创造' };
const VERBS: Record<string, string> = { explain: '解释', calculate: '计算', identify: '识别', compare: '比较', describe: '描述', apply: '应用', analyze: '分析', evaluate: '评价', create: '创造' };

export function QuestionDetailPanel({ question, objectives, knowledgeItems, onClose, onCompare, onOpenKnowledge, onOpenObjective }: {
  question: TrainingAssetRecord; objectives: TrainingAssetRecord[]; knowledgeItems: KnowledgeItem[];
  onClose(): void; onCompare(source: QuestionSource): void; onOpenKnowledge(id: string): void; onOpenObjective(objective: TrainingAssetRecord): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [question.id]);
  const options = choiceOptions(question);
  const sources = questionSources(question);
  const choice = ['singleChoice', 'multipleChoice'].includes(textValue(question.questionType));
  const answers = choice ? choiceAnswer(question) : [];
  return <article className={styles.detail} aria-label="题目详情">
    <header className={styles.header}>
      <div className={styles.headingRow}><span className={styles.eyebrow}>题目详情</span><Button variant="ghost" size="compact" onPress={onClose}>关闭详情</Button></div>
      <div className={styles.meta}><span>{reviewLabel(question)}</span><span>{questionTypeLabel(question.questionType)}</span><span>{difficultyLabel(question.difficulty)}</span><span>版本 {typeof question.version === 'number' ? question.version : '—'}</span></div>
      <h2 ref={heading} tabIndex={-1}>{question.stem ? <MathText text={question.stem} inlineOnly /> : '未填写题干'}</h2>
      {question.reviewStatus === 'candidate' ? <p className={styles.notice}>题目待确认，请核对目标、答案和来源。</p> : null}
    </header>
    {options.length ? <section className={styles.section} aria-label="题目选项"><h3>选项</h3><ol className={styles.options}>{options.map((option, index) => <li key={index}><strong>{option.id || '—'}</strong><span className={styles.prose}>{option.text ? <MathText text={option.text} inlineOnly /> : '未填写选项内容'}</span></li>)}</ol></section> : null}
    <section className={styles.section} aria-label="关联学习目标"><h3>关联学习目标 <span>{question.learningObjectiveIds?.length ?? 0}</span></h3>
      {!question.learningObjectiveIds?.length ? <p className={styles.hint}>尚未关联学习目标。</p> : <ol className={styles.objectives}>{question.learningObjectiveIds.map((id, index) => {
        const objective = objectives.find(item => item.id === id);
        const knowledge = knowledgeItems.find(item => item.id === objective?.knowledgeItemId);
        return <li key={`${id}-${index}`}>
          {objective ? <><p className={styles.prose}>{objective.objective ? <MathText text={objective.objective} inlineOnly /> : '未填写目标内容'}</p><div className={styles.meta}><span>{reviewLabel(objective)}</span><span>{VERBS[textValue(objective.actionVerb)] ?? textValue(objective.actionVerb)}</span><span>{LEVELS[textValue(objective.cognitiveLevel)] ?? textValue(objective.cognitiveLevel)}</span></div>
            <div className={styles.actions}><Button variant="ghost" size="mini" onPress={() => onOpenObjective(objective)}>查看学习目标</Button>{knowledge && !knowledge.deletedAt ? <Button className={styles.contentLink} variant="ghost" size="mini" onPress={() => onOpenKnowledge(knowledge.id)}>查看知识：{knowledge.title}</Button> : objective.knowledgeItemId ? <span className={styles.hint}>关联知识不可用</span> : null}</div>
          </> : <><p className={styles.notice}>关联目标不可用，仍保留原关联标识。</p><code className={styles.identifier}>{id}</code></>}
        </li>;
      })}</ol>}
    </section>
    <section className={styles.section} aria-label="参考答案"><h3>参考答案</h3>
      {choice ? answers.length ? <ul className={styles.values}>{answers.map((answer, index) => <li key={index}><MathText text={answer} inlineOnly /></li>)}</ul> : <p className={styles.hint}>尚未填写参考答案。</p>
        : question.questionType === 'trueFalse' && typeof question.referenceAnswer === 'boolean' ? <p className={styles.prose}>{question.referenceAnswer ? '正确' : '错误'}</p>
        : <QuestionValue value={question.referenceAnswer} empty="尚未填写参考答案。" />}
    </section>
    <section className={styles.section} aria-label="评分标准"><h3>评分标准</h3><QuestionValue value={question.rubric} empty="尚未填写评分标准。" /></section>
    <section className={styles.section} aria-label="题目解析"><h3>解析</h3><p className={question.explanation ? styles.prose : styles.hint}>{textValue(question.explanation) ? <MathText text={textValue(question.explanation)} /> : '尚未填写解析。'}</p></section>
    <section className={styles.section} aria-label="题目来源"><h3>来源对照 <span>{sources.length}</span></h3>
      {!sources.length ? <p className={styles.hint}>尚未记录题目来源。</p> : <ul className={styles.sources}>{sources.map(source => <li key={source.id}>
        <div className={styles.meta}><strong>{sourceTypeLabel(source.sourceType)}</strong><span>{sourceStatusLabel(source.status)}</span></div>
        {source.status === 'stale' ? <p className={styles.notice}>来源已变化，请对照后复核题目；原摘录继续保留。</p> : null}
        {Array.isArray(source.locator?.headingPath) ? <p className={styles.hint}>{source.locator.headingPath.filter(value => typeof value === 'string').join(' / ')}</p> : null}
        <blockquote className={styles.prose}>{source.quote ? <MathText text={source.quote} /> : '该来源未保存文字摘录。'}</blockquote>
        {source.sourceId ? <code className={styles.identifier}>{source.sourceId}</code> : null}
        {['knowledgeItem', 'learningObjective', 'knowledgeEvidence', 'noteVersion'].includes(source.sourceType) ? <Button variant="ghost" size="compact" onPress={() => onCompare(source)}>对照来源</Button> : <p className={styles.hint}>保留的来源说明可用于人工核对。</p>}
      </li>)}</ul>}
    </section>
    <footer className={styles.hint}>题目编号：<span className={styles.identifier}>{question.id}</span>{question.updatedAt ? <> · 更新于 {new Date(question.updatedAt).toLocaleString('zh-CN')}</> : null}</footer>
  </article>;
}
