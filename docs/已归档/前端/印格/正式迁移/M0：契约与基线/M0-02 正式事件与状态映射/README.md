# M0-02 正式事件与状态映射

## 任务状态

`修订报告完成 / 待规划与验收方复审`

本工作区只承载当前正式 Vanilla JS SPA 的视觉控件、正式 selector、事件绑定、controller、state 和 test 映射，不承载正式前端实现。

## 产出

- [M0-02 正式事件与状态映射报告.md](<M0-02 正式事件与状态映射报告.md>)

## 核心结论

- 正式前端和正式 Web 测试中未发现原型 `data-hook` 依赖。
- 当前已有行为 selector 可以支撑迁移；视觉容器可另加 `data-ui-*`，但不能替代现有行为属性。
- 已根据验收退回项补齐 `data-editor-cancel`、`data-editor-aside-toggle`、`data-create-question-from-objective`、四类 `data-inspector-kind` 以及边注旧/新动作的逐项可追溯映射。
- 报告明确区分当前 renderer 可达路径、历史未输出 selector、controller/state owner 和直接 binder 测试缺口；未将间接 renderer/controller 测试冒充事件闭环。
- 附件重命名和索引详情附件打开 selector 虽已由 renderer 输出，但尚未形成完整的正式事件路径，也没有对应的 binder 回归证据。
- 知识/训练工作域、编辑器内容和侧栏复杂事件需要补齐直接事件测试，才能把映射从“代码存在”提升为“迁移门禁可回归”。

## 边界

- 未修改正式前端代码、API、状态语义、迁移契约、规划方案或正式决策记录。
- 本报告不把缺失测试或未接线行为擅自判定为 PASS；验收报告原结论仍需由规划与验收方复审，后续实现任务需按报告中的缺口逐项处理。
