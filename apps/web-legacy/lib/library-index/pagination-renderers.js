import { LIBRARY_PAGE_SIZE_OPTIONS } from './model.js';

export function renderLibraryPagination({ page, pageSize, totalItems, totalPages }) {
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  return `
    <footer class="pagination">
      <span>第 ${page} / ${totalPages} 页 · 共 ${totalItems} 条</span>
      <nav class="pagination-pages" aria-label="资料分页">
        ${pages.map((pageNumber) => `
          <button
            type="button"
            data-index-page="${pageNumber}"
            data-active="${String(pageNumber === page)}"
            aria-label="第 ${pageNumber} 页"
            ${pageNumber === page ? 'aria-current="page"' : ''}
          >${pageNumber}</button>
        `).join('')}
      </nav>
      <div class="pagination-size" aria-label="每页资料数量">
        <span>每页</span>
        ${LIBRARY_PAGE_SIZE_OPTIONS.map((size) => `
          <button
            type="button"
            data-index-page-size="${size}"
            data-active="${String(size === pageSize)}"
            aria-pressed="${String(size === pageSize)}"
            aria-label="每页 ${size} 条"
          >${size}</button>
        `).join('')}
        <span>条</span>
      </div>
    </footer>
  `;
}
