import { escapeAttribute } from '../../src/app/formatting.js';

const ICON_ROOT = '/styles/icons/remix';

/**
 * Formal runtime icon contract.
 *
 * Renderers refer to semantic names only. The asset path is deliberately kept
 * here so a future icon refresh cannot reintroduce copied paths or runtime CDN
 * references in individual pages.
 */
export const ICON_MAP = Object.freeze({
  libraryMark: `${ICON_ROOT}/book-2-line.svg`,
  libraryIndex: `${ICON_ROOT}/book-open-line.svg`,
  create: `${ICON_ROOT}/add-line.svg`,
  more: `${ICON_ROOT}/more-2-line.svg`,
  back: `${ICON_ROOT}/arrow-left-line.svg`,
  search: `${ICON_ROOT}/search-line.svg`,
  notification: `${ICON_ROOT}/notification-3-line.svg`,
  settings: `${ICON_ROOT}/settings-4-line.svg`,
  user: `${ICON_ROOT}/user-smile-line.svg`,
  filterChevron: `${ICON_ROOT}/arrow-down-s-line.svg`,
  navigationChevron: `${ICON_ROOT}/arrow-right-s-line.svg`,
  disclosureChevron: `${ICON_ROOT}/arrow-down-s-line.svg`,
  folder: `${ICON_ROOT}/folder-line.svg`,
  folderOpen: `${ICON_ROOT}/folder-open-line.svg`,
  noteMarkdown: `${ICON_ROOT}/file-text-line.svg`,
  notePdf: `${ICON_ROOT}/file-pdf-2-line.svg`,
  noteResource: `${ICON_ROOT}/file-list-3-line.svg`,
  noteManual: `${ICON_ROOT}/edit-2-line.svg`,
  inspectorOpen: `${ICON_ROOT}/external-link-line.svg`,
  archive: `${ICON_ROOT}/bookmark-3-line.svg`,
  sectionFile: `${ICON_ROOT}/file-text-line.svg`,
  sectionTag: `${ICON_ROOT}/price-tag-3-line.svg`,
  sectionLink: `${ICON_ROOT}/links-line.svg`,
  sectionList: `${ICON_ROOT}/list-check-3.svg`,
  sectionAttachment: `${ICON_ROOT}/attachment-2.svg`,
  rename: `${ICON_ROOT}/edit-2-line.svg`,
  confirm: `${ICON_ROOT}/check-line.svg`,
  cancel: `${ICON_ROOT}/close-line.svg`,
  moduleMaterials: `${ICON_ROOT}/stack-line.svg`,
  moduleKnowledge: `${ICON_ROOT}/book-2-line.svg`,
  moduleTraining: `${ICON_ROOT}/file-list-3-line.svg`,
  moduleLearning: `${ICON_ROOT}/book-open-line.svg`,
  modulePaper: `${ICON_ROOT}/file-text-line.svg`,
  moduleAi: `${ICON_ROOT}/sparkling-2-line.svg`,
  moduleTask: `${ICON_ROOT}/task-line.svg`,
  moduleReview: `${ICON_ROOT}/refresh-line.svg`,
  navOverview: `${ICON_ROOT}/book-open-line.svg`,
  navMaterials: `${ICON_ROOT}/stack-line.svg`,
  navFavorites: `${ICON_ROOT}/star-line.svg`,
  navRecycle: `${ICON_ROOT}/delete-bin-6-line.svg`,
  navQuickNote: `${ICON_ROOT}/edit-2-line.svg`,
  navFolders: `${ICON_ROOT}/folder-open-line.svg`,
  navTags: `${ICON_ROOT}/price-tag-3-line.svg`,
  navAttachments: `${ICON_ROOT}/attachment-2.svg`,
  navKnowledge: `${ICON_ROOT}/book-2-line.svg`,
  navKnowledgeItems: `${ICON_ROOT}/book-2-line.svg`,
  navKnowledgeLinks: `${ICON_ROOT}/links-line.svg`,
  navTraining: `${ICON_ROOT}/file-list-3-line.svg`,
  navQuestionBank: `${ICON_ROOT}/file-text-line.svg`,
  navPractice: `${ICON_ROOT}/task-line.svg`,
  navReview: `${ICON_ROOT}/refresh-line.svg`,
  navLearning: `${ICON_ROOT}/book-open-line.svg`,
  navMastery: `${ICON_ROOT}/book-open-line.svg`,
  navLearningCurve: `${ICON_ROOT}/refresh-line.svg`,
  navCreateSpace: `${ICON_ROOT}/add-line.svg`,
  homeWriting: `${ICON_ROOT}/edit-2-line.svg`,
  homeKnowledge: `${ICON_ROOT}/links-line.svg`,
  homeTraining: `${ICON_ROOT}/list-check-3.svg`,
  homeRecent: `${ICON_ROOT}/refresh-line.svg`,
  homeCalendar: `${ICON_ROOT}/bookmark-3-line.svg`,
  editorCut: `${ICON_ROOT}/scissors-2-line.svg`,
  editorCopy: `${ICON_ROOT}/file-copy-2-line.svg`,
  editorPaste: `${ICON_ROOT}/clipboard-line.svg`,
  editorDelete: `${ICON_ROOT}/delete-bin-6-line.svg`,
  editorBold: `${ICON_ROOT}/bold.svg`,
  editorItalic: `${ICON_ROOT}/italic.svg`,
  editorHighlight: `${ICON_ROOT}/mark-pen-line.svg`,
  editorCode: `${ICON_ROOT}/code-line.svg`,
  editorCodeblock: `${ICON_ROOT}/code-block.svg`,
  editorQuote: `${ICON_ROOT}/double-quotes-l.svg`,
  editorImportant: `${ICON_ROOT}/star-line.svg`,
  editorTable: `${ICON_ROOT}/table-2.svg`,
  editorOrdered: `${ICON_ROOT}/list-ordered.svg`,
  editorBullet: `${ICON_ROOT}/list-unordered.svg`,
  editorTaskList: `${ICON_ROOT}/list-check-3.svg`,
  editorOutdent: `${ICON_ROOT}/indent-decrease.svg`,
  editorIndent: `${ICON_ROOT}/indent-increase.svg`,
  editorQuestion: `${ICON_ROOT}/question-mark.svg`,
  tableAddRow: `${ICON_ROOT}/add-line.svg`,
  tableAddCol: `${ICON_ROOT}/add-line.svg`,
  tableAddRowBefore: `${ICON_ROOT}/insert-row-top.svg`,
  tableAddRowAfter: `${ICON_ROOT}/insert-row-bottom.svg`,
  tableAddColBefore: `${ICON_ROOT}/insert-column-left.svg`,
  tableAddColAfter: `${ICON_ROOT}/insert-column-right.svg`,
  tableDeleteRow: `${ICON_ROOT}/delete-row.svg`,
  tableDeleteCol: `${ICON_ROOT}/delete-column.svg`,
  tableAlignLeft: `${ICON_ROOT}/align-left.svg`,
  tableAlignCenter: `${ICON_ROOT}/align-center.svg`,
  tableAlignRight: `${ICON_ROOT}/align-right.svg`,
  tableColumnDrag: `${ICON_ROOT}/draggable.svg`,
  tableRowDrag: `${ICON_ROOT}/draggable.svg`,
  imageConfirm: `${ICON_ROOT}/check-line.svg`
});

export const ICON_NAMES = Object.freeze(Object.keys(ICON_MAP));

export function getIconPath(name) {
  return ICON_MAP[name] ?? null;
}

export function renderIcon(name, { className = '', data = {} } = {}) {
  const path = getIconPath(name);
  if (!path) {
    return '';
  }

  const classes = ['semantic-icon', className].filter(Boolean).join(' ');
  const dataAttributes = Object.entries(data)
    .filter(([key]) => key.startsWith('data-'))
    .map(([key, value]) => ` ${escapeAttribute(key)}="${escapeAttribute(value)}"`)
    .join('');

  return `<span class="${escapeAttribute(classes)}" data-icon="${escapeAttribute(name)}" aria-hidden="true"${dataAttributes} style="--icon-source: url(${escapeAttribute(path)})"></span>`;
}
