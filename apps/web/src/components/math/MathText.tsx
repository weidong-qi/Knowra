// 样式随组件一起进入主包，避免列表里首个公式出现时才补样式而闪动；渲染库本身仍按需加载。
import 'katex/dist/katex.min.css';
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { hasMath, splitMath } from './splitMath';
import styles from './MathText.module.css';

/** 公式渲染库按需加载：文本里确实有公式时才下载 KaTeX。 */
let rendererPromise: Promise<typeof import('./mathRender')> | null = null;
const loadRenderer = () => (rendererPromise ??= import('./mathRender'));

function MathSpan({ source, display, raw }: { source: string; display: boolean; raw: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let active = true;
    void loadRenderer().then(({ renderMath }) => { if (!active || !ref.current) return;
      renderMath(ref.current, source, display);
      // 无法解析的公式回到原文，阅读区不展示解析错误。
      if (ref.current.classList.contains('math-error')) { ref.current.classList.remove('math-error'); ref.current.textContent = raw; }
    });
    return () => { active = false; };
  }, [source, display, raw]);
  // 渲染完成前先显示原文；KaTeX 会整体替换其内容。
  return <span ref={ref} className={display ? styles.display : styles.inline} data-math-text="">{raw}</span>;
}

/** 在普通文本里渲染 `$…$` / `$$…$$` / `\(…\)` / `\[…\]`；其余内容保持 React 文本节点。 */
export function MathText({ text, inlineOnly = false }: { text: string; inlineOnly?: boolean }): ReactNode {
  const segments = useMemo(() => hasMath(text) ? splitMath(text) : null, [text]);
  if (!segments) return text;
  return <>{segments.map((segment, index) => segment.type === 'text'
    ? <Fragment key={index}>{segment.value}</Fragment>
    : inlineOnly && segment.display
      ? <Fragment key={index}>{segment.raw}</Fragment>
      : <MathSpan key={index} source={segment.source} display={segment.display && !inlineOnly} raw={segment.raw} />)}</>;
}

/** 独占一段的块公式。 */
export function MathBlock({ source, raw = source }: { source: string; raw?: string }) {
  return <div className={styles.block}><MathSpan source={source} display raw={raw} /></div>;
}
