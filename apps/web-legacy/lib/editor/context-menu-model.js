export const EDITOR_CONTEXT_PRIMARY_ACTIONS = ['cut', 'copy', 'paste', 'delete'];
export const EDITOR_CONTEXT_FORMAT_ACTIONS = ['bold', 'italic', 'highlight', 'code', 'quote', 'create-annotation'];
export const EDITOR_CONTEXT_LIST_ACTIONS = ['ordered', 'bullet', 'task-list'];
export const EDITOR_CONTEXT_INDENT_ACTIONS = ['outdent', 'indent'];

export const EDITOR_CONTEXT_PARAGRAPH_ITEMS = [
  'paragraph',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4'
];

export const EDITOR_CONTEXT_INSERT_ITEMS = [
  'table',
  'hr',
  'image',
  'codeblock',
  'quote',
  'paragraph-above',
  'paragraph-below'
];

export const editorContextActionMeta = {
  cut: { label: '剪切', icon: 'cut' },
  copy: { label: '复制', icon: 'copy' },
  paste: { label: '粘贴', icon: 'paste' },
  delete: { label: '删除', icon: 'delete' },
  bold: { label: '加粗', icon: 'bold' },
  italic: { label: '斜体', icon: 'italic' },
  highlight: { label: '高亮', icon: 'highlight' },
  code: { label: '行内代码', icon: 'code' },
  codeblock: { label: '代码块', icon: 'codeblock' },
  quote: { label: '引用', icon: 'quote' },
  ordered: { label: '有序列表', icon: 'ordered' },
  bullet: { label: '无序列表', icon: 'bullet' },
  'task-list': { label: '任务列表', icon: 'task-list' },
  outdent: { label: '减少缩进', icon: 'outdent' },
  indent: { label: '增加缩进', icon: 'indent' },
  paragraph: { label: '段落' },
  'heading-1': { label: 'H1' },
  'heading-2': { label: 'H2' },
  'heading-3': { label: 'H3' },
  'heading-4': { label: 'H4' },
  table: { label: '表格', icon: 'table' },
  'create-annotation': { label: '重点', icon: 'important' },
  hr: { label: '水平分割线' },
  'paragraph-above': { label: '段落（上方）' },
  'paragraph-below': { label: '段落（下方）' },
  image: { label: '图片' }
};
