import { MathText } from '../../components/math/MathText';
import styles from './QuestionDetailPanel.module.css';

const FIELD_LABELS: Record<string, string> = {
  totalPoints: '总分', maxPoints: '最高分', points: '分值', score: '分值', criteria: '评分要点',
  description: '说明', text: '内容', answer: '答案', explanation: '解释', name: '名称', title: '标题',
  weight: '权重', required: '是否必需', keywords: '关键词', levels: '评分等级', feedback: '反馈'
};

/** Rubric has no frozen schema. Preserve every value without inventing grading rules. */
export function QuestionValue({ value, empty = '尚未填写', depth = 0 }: { value: unknown; empty?: string; depth?: number }) {
  if (value === null || value === undefined || value === '') return <p className={styles.hint}>{empty}</p>;
  if (typeof value !== 'object') return <p className={styles.prose}>{typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'string' ? <MathText text={value} /> : String(value)}</p>;
  if (depth >= 8) return <pre className={styles.prose}>{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value)) return value.length ? <ol className={styles.values}>{value.map((item, index) => <li key={index}><QuestionValue value={item} depth={depth + 1} /></li>)}</ol> : <p className={styles.hint}>{empty}</p>;
  const entries = Object.entries(value);
  return entries.length ? <dl className={styles.fields}>{entries.map(([key, item]) => <div key={key}><dt>{FIELD_LABELS[key] ?? key}</dt><dd><QuestionValue value={item} depth={depth + 1} /></dd></div>)}</dl> : <p className={styles.hint}>{empty}</p>;
}
