# AI-01-01：Gateway、Mock 与 DeepSeek 适配器

> 适用范围（2026-09-27）：本文件记录原 P1 的实现与验收，文中的状态、日期和通过数不代表新版 Agent 已完成。范围问答基础继续复用；多轮对话、自动库检索、授权 v2 与插件故障隔离按 [补齐方案](../06-P1对话Agent补齐方案.md) 和 [任务表](../04-分阶段开发任务.md) 另行实施。旧发送预览流程仅作为显式指定范围/历史复测入口，不是普通聊天的必经步骤。

日期：2026-09-26。状态：**代码与离线验收完成；真实账号能力探测待实际发送范围与账号验收。** 不把 Mock 或公开文档当作当前账号已通过。

## 实现

- [Gateway](../../../apps/api/src/modules/ai/gateway.js)仅接受受信服务提供的消息、模型工具目录和内部凭据引用；统一返回文本、JSON 对象、工具建议、结束原因、拒答/截断与用量。工具建议仅解析，不执行笔记操作。JSON 解析失败、未知工具或参数、异常流都阻断。
- [Mock 适配器](../../../apps/api/src/modules/ai/infrastructure/providers/mock-adapter.js)以脚本步骤复现文本、流式、工具调用、畸形结果和错误，不访问网络或凭据。
- [DeepSeek 适配器](../../../apps/api/src/modules/ai/infrastructure/providers/deepseek-adapter.js)固定请求 `https://api.deepseek.com/chat/completions`；禁用重定向，限制响应字节，支持 Chat Completions 文本、`response_format=json_object`、函数工具建议和 SSE 流式输出。支持取消信号；401/402/429/5xx 等仅返回受控错误码与中文消息，不记录供应商错误正文或密钥。
- [能力探测器](../../../apps/api/src/modules/ai/capability-probe.ts)仅使用合成提示词，分别记录文本、JSON、工具、截断、拒答、流式与取消的观察状态、时延和可得用量，不保存提示词或模型全文。拒答未出现记为 `notObserved`，不能推断不支持；用量缺失记 `unknown`。
- JSON/PostgreSQL 的应用上下文装配[运行时](../../../apps/api/src/modules/ai/runtime.js)；Mac 本地服务也装配 Gateway。当前没有生成 HTTP/IPC 路由。AI-01-04 已接入 Worker 预留后的短期票据，但生产运行时仍关闭实际外发；未持票请求在读取密钥之前被拒绝。

DeepSeek [官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)列出 `deepseek-flash`、`finish_reason`、SSE、JSON 模式和工具调用；[JSON 指南](https://api-docs.deepseek.com/guides/json_mode/)要求提示词明确 JSON 并提醒可能出现空内容；[错误码](https://api-docs.deepseek.com/quick_start/error_codes/)列出 401/402/429/5xx。以上只用于确定适配和错误分支，**不代表用户账号已实测**。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npm run test:api` | 292/292 通过；包含 Mock 探测、预算先于凭据、固定端点、JSON/工具/流式/截断/拒答和供应商错误不泄密。 |
| `npm run test:desktop` | 71 通过；4 项真实 PostgreSQL 条件跳过。 |
| `npm run build:web` | 通过。 |
| `npm run build -w @study-accelerator/desktop-shell` | Mac 包构建与签名通过；未安装到 `/Applications`。 |
| 本机 Web 账号 `GET /models` | 已返回当前配置模型 `deepseek-flash`；只证明凭据有效和模型可见，不证明生成、JSON、工具或流式能力与可用额度。 |
| 真实 DeepSeek 生成 | 未运行。预算执行器已有隔离验收，实际发送范围与当前价格仍待 AI-01-05／账号验收。 |

Mock 探测的 7 项状态均为 `observed`，这只证明本地归一化和探测流程能处理这些响应。供应商能力声明中的 `advertised` 来自官方接口，`verified=false` 直到按计费账户在预算预留下逐项真实探测。生成、工具执行和助手 UI 仍不可对用户开放。
