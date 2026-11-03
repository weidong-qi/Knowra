import { indentWithTab } from '@codemirror/commands';
import { keymap } from '@codemirror/view';
import { defaultConfig as defaultCodeBlockConfig } from '@milkdown/kit/component/code-block';

export function createCodeBlockComponentConfig() {
  return {
    ...defaultCodeBlockConfig,
    extensions: [
      ...defaultCodeBlockConfig.extensions,
      keymap.of([indentWithTab])
    ],
    languages: [...defaultCodeBlockConfig.languages],
    expandIcon: '',
    searchPlaceholder: '搜索语言',
    noResultText: '暂无可用语言',
    copyText: '复制',
    copyIcon: '',
    previewLabel: '预览',
    previewLoading: '正在生成预览…'
  };
}
