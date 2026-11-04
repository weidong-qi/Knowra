import { renderAsideEmptyInline } from './renderers.js';
import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';

export function renderOutlineTab({
  headings = [],
  noteId = '',
  collapsedHeadingIds = {}
} = {}) {
  const visibleItems = buildVisibleOutlineItems({
    headings,
    collapsedHeadingIds
  });

  return `
    <section class="outline-panel">
      <div class="outline-panel-head">
        <span>DOCUMENT MAP</span>
        <strong>${headings.length} 个标题</strong>
      </div>
      <div class="outline-list outline-editorial">
          ${visibleItems.length
            ? visibleItems
                .map(
                  ({ heading, depth, hasChildren, isCollapsed }) => `
                    <div class="outline-row outline-row-ui level-h${heading.level}" data-level="${heading.level}" data-depth="${depth}" data-has-children="${String(hasChildren)}">
                      ${hasChildren
                        ? `
                            <button
                              type="button"
                              class="outline-toggle outline-toggle-ui"
                              data-outline-toggle-id="${escapeAttribute(heading.id)}"
                              data-outline-note-id="${escapeAttribute(noteId)}"
                              data-collapsed="${String(isCollapsed)}"
                              aria-label="${isCollapsed ? '展开' : '折叠'} ${escapeAttribute(heading.title)} 的子标题"
                              aria-expanded="${String(!isCollapsed)}"
                            >
                              <span aria-hidden="true" class="outline-toggle-glyph">${renderOutlineToggleIcon(isCollapsed)}</span>
                            </button>
                          `
                        : '<span class="outline-toggle-spacer outline-toggle-space" aria-hidden="true"></span>'}
                      <button
                        type="button"
                        class="outline-item outline-jump"
                        data-outline-id="${escapeAttribute(heading.id)}"
                        data-outline-index="${heading.index}"
                        data-level="${heading.level}"
                        data-depth="${depth}"
                      >
                        <span class="outline-item-level">H${heading.level}</span>
                        <strong class="outline-item-label">${escapeHtml(heading.title)}</strong>
                      </button>
                    </div>
                  `
                )
                .join('')
            : renderAsideEmptyInline('当前笔记还没有标题')}
      </div>
    </section>
  `;
}

function buildVisibleOutlineItems({ headings, collapsedHeadingIds }) {
  const normalizedHeadings = normalizeHeadingDepths(headings);
  const descendantCounts = countHeadingDescendants(normalizedHeadings);
  const collapsedDepths = [];

  return normalizedHeadings.flatMap((heading) => {
    while (collapsedDepths.length && collapsedDepths[collapsedDepths.length - 1] >= heading.depth) {
      collapsedDepths.pop();
    }

    if (collapsedDepths.length) {
      return [];
    }

    const hasChildren = (descendantCounts.get(heading.id) ?? 0) > 0;
    const isCollapsed = Boolean(collapsedHeadingIds[heading.id]);

    if (hasChildren && isCollapsed) {
      collapsedDepths.push(heading.depth);
    }

    return [{
      heading,
      depth: heading.depth,
      hasChildren,
      isCollapsed
    }];
  });
}

function countHeadingDescendants(headings) {
  const counts = new Map();
  const stack = [];

  headings.forEach((heading) => {
    while (stack.length && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    stack.forEach((ancestor) => {
      counts.set(ancestor.id, (counts.get(ancestor.id) ?? 0) + 1);
    });

    stack.push(heading);
  });

  return counts;
}

function normalizeHeadingDepths(headings) {
  const stack = [];

  return headings.map((heading) => {
    while (stack.length && stack[stack.length - 1] >= heading.level) {
      stack.pop();
    }

    const normalizedHeading = {
      ...heading,
      depth: stack.length
    };

    stack.push(heading.level);
    return normalizedHeading;
  });
}

function renderOutlineToggleIcon(isCollapsed) {
  return renderIcon(isCollapsed ? 'navigationChevron' : 'disclosureChevron', {
    className: 'outline-toggle-icon'
  });
}
