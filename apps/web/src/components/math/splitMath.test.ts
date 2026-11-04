import { describe, expect, it } from 'vitest';
import { splitMath } from './splitMath';

const kinds = (input: string) => splitMath(input).map(segment => segment.type === 'text' ? segment.value : `[${segment.display ? 'D' : 'I'}:${segment.source}]`);

describe('splitMath', () => {
  it('切出行内与块公式', () => {
    expect(kinds('已知 $x^2$ 与 $$\\frac{a}{b}$$ 成立')).toEqual(['已知 ', '[I:x^2]', ' 与 ', '[D:\\frac{a}{b}]', ' 成立']);
    expect(kinds('\\(a+b\\) 和 \\[c\\]')).toEqual(['[I:a+b]', ' 和 ', '[D:c]']);
  });

  it('金额、孤立美元符号与转义保持原文', () => {
    expect(kinds('价格 $5 和 $10')).toEqual(['价格 $5 和 $10']);
    expect(kinds('$5-$10')).toEqual(['$5-$10']);
    expect(kinds('$ x $')).toEqual(['$ x $']);
    expect(kinds('费用 \\$3 与 \\$4')).toEqual(['费用 $3 与 $4']);
  });

  it('未闭合的定界符一律是普通文字，便于流式输出', () => {
    expect(kinds('推导 $\\frac{1')).toEqual(['推导 $\\frac{1']);
    expect(kinds('$$x+')).toEqual(['$$x+']);
    expect(kinds('\\(x')).toEqual(['\\(x']);
    expect(kinds('$$ $$')).toEqual(['$$ $$']);
  });

  it('行内公式不跨行', () => {
    expect(kinds('$a\nb$')).toEqual(['$a\nb$']);
  });
});
