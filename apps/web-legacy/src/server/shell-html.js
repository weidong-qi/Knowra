import { renderIcon } from '../../lib/icons/icon-map.js';

export function renderHtml(initialWorkspaceScript = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>知境·Knowra</title>
  <meta name="description" content="A modular learning workspace centered on knowledge bases" />
  <link rel="stylesheet" href="/src/styles.css" />
  <link rel="stylesheet" href="/lib/editor/milkdown-bundle.css" />
</head>
<body>
  <div id="app">
    <div class="app-shell workspace-shell app-root knowra-production-shell" id="workspace-shell" data-screen="home">
      <header class="top-bar app-topbar" data-ui-topbar data-region="shell-topbar" aria-label="全局顶栏">
        <div class="topbar-brand" data-ui-topbar-brand>
          <span class="topbar-brand-mark" aria-hidden="true"><span>知</span></span>
          <span class="topbar-brand-name">知境 Knowra</span>
        </div>
        <div class="top-bar-search topbar-search-slot" id="global-search-shell" role="search" aria-label="全局搜索"></div>
        <div class="topbar-actions" data-ui-topbar-actions aria-label="全局操作">
          <button type="button" class="topbar-action ink-button ink-button-icon" data-topbar-placeholder="notifications" aria-label="通知（即将开放）" title="通知（即将开放）">
            ${renderIcon('notification', { className: 'topbar-action-icon' })}
          </button>
          <button type="button" class="topbar-action settings-button ink-button ink-button-icon" data-topbar-placeholder="settings" aria-label="设置（即将开放）" title="设置（即将开放）">
            ${renderIcon('settings', { className: 'topbar-action-icon' })}
          </button>
          <span class="topbar-separator" aria-hidden="true"></span>
          <button type="button" class="topbar-user ink-button" data-topbar-placeholder="user" aria-label="用户中心（即将开放）" title="用户中心（即将开放）">
            ${renderIcon('user', { className: 'topbar-user-icon' })}
            <span class="topbar-user-label">用户中心</span>
          </button>
        </div>
      </header>
      <div class="shell-body" data-ui-shell-body>
      <nav class="function-navigation" id="module-rail" data-ui-function-navigation aria-label="全局功能导航"></nav>

      <aside class="kb-sidebar knowra-rail" id="kb-sidebar" data-ui-library-directory aria-label="资料库目录">
        <section class="library-directory">
          <div class="library-label">
            <button type="button" class="library-home-target" data-library-home="global" aria-label="返回资料索引">
              <span class="library-mark" aria-hidden="true">
                ${renderIcon('libraryMark', { className: 'library-mark-icon' })}
              </span>
              <span class="library-copy"><strong>资料库</strong><small>LIBRARY</small></span>
              <span class="library-index-directory-label" aria-hidden="true">资料目录</span>
            </button>
            <span class="library-header-actions">
              <button type="button" class="library-index-header-action library-index-create-folder" data-index-directory-create aria-label="新建文件夹" title="新建文件夹">
                ${renderIcon('create', { className: 'library-index-header-action-icon' })}
              </button>
              <button type="button" class="library-index-header-action library-index-directory-toggle" id="library-index-directory-toggle" data-index-directory-toggle aria-expanded="true" aria-controls="kb-sidebar" aria-label="折叠目录栏" title="折叠目录栏">
                ${renderIcon('navigationChevron', { className: 'library-index-header-action-icon' })}
              </button>
              <button type="button" class="library-header-toggle" id="secondary-nav-toggle" aria-label="显示导航入口菜单" title="显示导航入口菜单">
                ${renderIcon('more', { className: 'library-header-toggle-icon' })}
              </button>
            </span>
          </div>
          <div class="directory-group-label directory-heading">内容与文件夹</div>
          <div class="library-tree" id="folder-tree"></div>
        </section>
      </aside>
      <button type="button" class="library-index-directory-reopen" id="library-index-directory-reopen" data-index-directory-toggle aria-expanded="false" aria-controls="kb-sidebar" aria-label="展开目录栏" title="展开目录栏" hidden>
        ${renderIcon('navigationChevron', { className: 'library-index-directory-reopen-icon' })}
      </button>

      <div class="feature-stage workspace-main" data-ui-feature-stage>
        <main class="workspace-stage">
          <section class="home-workspace-view" id="home-workspace-view">
            <div id="home-workspace-content">
              <div class="home-workspace home-workspace-loading" data-home-workspace data-home-loading="true">
                <div class="home-loading-state" role="status" aria-live="polite">
                  <span class="home-section-kicker">WORKBENCH</span>
                  <strong>正在加载资料工作台…</strong>
                  <span>正在读取真实资料与文件夹状态。</span>
                </div>
              </div>
            </div>
          </section>
          <section class="work-domain-view" id="work-domain-view" hidden>
            <div id="work-domain-content"></div>
          </section>
          <section class="library-index-view" id="library-index-view" hidden>
            <main class="index-workspace">
              <header class="masthead">
                <div class="masthead-title"><h1>资料库</h1><div class="scope-summary" id="library-index-scope" aria-live="polite"></div></div>
                <button type="button" class="primary-button" data-index-new-note>
                  ${renderIcon('create', { className: 'masthead-create-icon' })}
                  <span>新建资料</span>
                </button>
              </header>
              <nav class="content-tabs" id="library-index-tabs" role="tablist" aria-label="资料筛选"></nav>
              <div class="filter-row">
                <div class="index-filter-controls" id="library-index-filters"></div>
              </div>
              <div class="library-index-content" id="library-index-content" role="tabpanel" aria-labelledby="library-index-tab-all" tabindex="0"></div>
            </main>
            <aside class="index-inspector" id="library-index-inspector" aria-label="资料详情"></aside>
          </section>

          <section class="editor-workspace-view" id="editor-workspace-view" hidden>
            <div class="kb-workspace" id="kb-workspace" data-left-hidden="false" data-right-hidden="false" data-view-mode="edit">
              <section class="kb-editor editor-workspace">
                <header class="document-tabs">
                  <button type="button" class="back-index" data-library-home="back" aria-label="返回资料索引">${renderIcon('back', { className: 'back-index-icon' })}</button>
                  <div class="note-tabs" id="note-tabs" role="tablist" aria-label="已打开的资料"></div>
                  <div class="note-tab-overflow-toggle-host" id="note-tab-overflow-toggle-host"></div>
                  <div class="note-tab-overflow-menu" id="note-tab-overflow-menu" role="menu" aria-label="隐藏的资料标签" hidden></div>
                </header>
                <div class="editor-menu-bar" id="editor-menu-bar"></div>
                <section class="editor-shell" id="editor-scroll-region" role="tabpanel" aria-label="资料编辑内容" tabindex="0">
                  <div class="editor-document-head" id="editor-document-head"></div>
                  <div class="editor-content" id="editor-content" data-source-open="false">
                    <section class="preview-pane preview-frame">
                      <div class="pane-body">
                        <article class="preview-rendered" id="preview-content"></article>
                      </div>
                    </section>
                  </div>
                </section>
              </section>
              <aside class="kb-aside editor-inspector" id="kb-aside" aria-labelledby="editor-aside-title">
                <header class="aside-heading">
                  <div><b id="editor-aside-title">资料边注</b><span>MARGINALIA</span></div>
                  <button type="button" id="editor-aside-toggle" data-editor-aside-toggle aria-expanded="true" aria-controls="kb-aside" aria-label="收起资料边注" title="收起资料边注">
                    ${renderIcon('navigationChevron', { className: 'editor-aside-toggle-icon' })}
                  </button>
                </header>
                <div class="aside-tabs" id="aside-tabs"></div>
                <div class="aside-panel-scroll">
                  <div class="aside-content" id="aside-content"></div>
                </div>
              </aside>
              <button type="button" class="reopen-panel editor-reopen" id="editor-aside-reopen" data-editor-aside-toggle aria-expanded="false" aria-controls="kb-aside" aria-label="展开资料边注" title="展开资料边注" hidden>侧栏</button>
            </div>
          </section>
        </main>
      </div>
      </div>
      <footer class="status-bar status-bar-host" data-ui-status-bar data-region="shell-footer">
        <div class="status-group status-feature-slot" id="status-indicators" data-ui-status-feature data-status-slot="feature" aria-label="当前功能状态"></div>
        <div class="status-group status-global-slot status-group-end" id="status-meta" data-ui-status-global data-status-slot="global" aria-label="全局连接状态"></div>
      </footer>
    </div>
  </div>
  <div class="library-context-menu" id="library-context-menu" hidden></div>
  <div class="library-context-menu library-section-menu" id="library-section-menu" hidden></div>
  <div class="note-tab-menu" id="note-tab-menu" hidden></div>
  <div class="editor-context-menu" id="editor-context-menu" hidden></div>
  <input id="markdown-import-input" type="file" accept=".md,.markdown,text/markdown,text/plain" multiple hidden />
  ${initialWorkspaceScript}
  <script type="module" src="/src/client.js"></script>
</body>
</html>`;
}
