// aside-events/index.js
// 侧栏（elements.asideTabs / elements.asideContent）事件绑定的桶入口。
// 拆分依据：
//   - asideTabs.click      切换侧栏 tab（asideTab 状态机）
//   - asideContent.click   派发侧栏 [data-*] 按钮分支，覆盖标签、
//                          知识点（filter / toggle / edit / attach /
//                          source-remove / delete / source-jump）和
//                          大纲跳转与分级折叠
//   - asideContent.input   同步侧栏内 4 类输入（知识点过滤 / 编辑表单 /
//                          挂载搜索 / 标签 composer）
//   - asideContent.submit  派发知识点编辑表单的提交
//   - asideContent.keydown 标签 composer 的 Enter 提交
// 五个监听器按职责切到 4 个子文件，bindAsideEvents 串行调用以保持
// 注册顺序与原 bindEvents() 完全一致。
//
// 由 client.js 的 bindEvents() 在初始化时一次性注册。

import { bindAsideTabsEvents } from './tabs.js';
import { bindAsideContentClickEvents } from './click.js';
import { bindAsideContentDoubleClickEvents } from './dblclick.js';
import { bindAsideContentContextMenuEvents } from './context-menu.js';
import { bindAsideContentInputEvents } from './input.js';
import { bindAsideContentFormEvents } from './forms.js';

export function bindAsideEvents({ state, elements, deps }) {
  bindAsideTabsEvents({ state, elements, deps });
  bindAsideContentClickEvents({ state, elements, deps });
  bindAsideContentDoubleClickEvents({ state, elements, deps });
  bindAsideContentContextMenuEvents({ state, elements, deps });
  bindAsideContentInputEvents({ state, elements, deps });
  bindAsideContentFormEvents({ state, elements, deps });
}
