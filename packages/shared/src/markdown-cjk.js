import { cjkFriendlyExtension } from 'micromark-extension-cjk-friendly';
import { classifyCharacter } from 'micromark-util-classify-character';

const ASTERISK = 42;
const UNDERSCORE = 95;
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;

/** CommonMark 分类，但 emoji（如 ✅）按普通字符算：写出端不会为它编码相邻字符，解析端须同样认可。 */
function classify(code) {
  if (code !== null && code >= 0 && PICTOGRAPHIC.test(String.fromCharCode(code))) return undefined;
  return classifyCharacter(code);
}

/**
 * 笔记解析用的强调定界符扩展：在 CJK 友好规则（`**小标题：**正文` 可闭合）之外，保留 CommonMark 原本
 * 能成立的开闭判断。CJK 扩展把 emoji 等 `\p{S}` 字符当标点，`abc**😀**def` 在它下面不能闭合，
 * 而编辑器写出端认为可以——取两套规则的并集，并把 emoji 按普通字符判断，写出的强调都能读回。
 * 编辑器与 content-anchor / shared 解析器共用，保证偏移一致。
 */
export function cjkFriendlyEmphasisExtension() {
  const attention = cjkFriendlyExtension().text[ASTERISK];
  const construct = { ...attention, tokenize: withCommonmarkFlags(attention.tokenize) };
  return {
    text: { [ASTERISK]: construct, [UNDERSCORE]: construct },
    insideSpan: { null: [construct] }
  };
}

function withCommonmarkFlags(tokenize) {
  return function tokenizeAttention(effects, ok, nok) {
    const previous = this.previous;
    const before = classify(previous);
    const markers = this.parser.constructs.attentionMarkers.null ?? [];
    let token;
    const tracked = Object.create(effects);
    tracked.exit = type => {
      const exited = effects.exit(type);
      if (type === 'attentionSequence') token = exited;
      return exited;
    };
    const done = code => {
      if (token) {
        // 与 micromark-core-commonmark 的 attention 相同的开闭判断。
        const kind = this.sliceSerialize(token).charCodeAt(0);
        const after = classify(code);
        const open = !after || (after === 2 && before) || markers.includes(code);
        const close = !before || (before === 2 && after) || markers.includes(previous);
        token._open ||= Boolean(kind === ASTERISK ? open : open && (before || !close));
        token._close ||= Boolean(kind === ASTERISK ? close : close && (after || !open));
      }
      return ok(code);
    };
    return tokenize.call(this, tracked, done, nok);
  };
}
