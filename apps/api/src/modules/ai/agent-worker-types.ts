import type { GatewayRequest } from './gateway.ts';
import type { AgentWorkerOptions } from './boundary-types.ts';
import type { SourceReference } from './access-service-types.ts';

export type AgentManifest = Awaited<
  ReturnType<NonNullable<AgentWorkerOptions['access']>['prepareRequest']>
>['manifest'];
export type AgentRequest = GatewayRequest & { tools: NonNullable<GatewayRequest['tools']> };
export interface AgentResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  truncated: boolean;
  refused: boolean;
  json?: unknown;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: object;
}
export interface RawReadArguments {
  noteId?: unknown;
  start?: unknown;
  end?: unknown;
}
export interface CatalogDependencies {
  noteIds: string[];
  folderIds: string[];
}
export interface ToolReceipt {
  sourceRefs?: SourceReference[];
  resultJson?: object | null;
  errorCode?: string | null;
  hint?: string;
}
export interface RawCitation {
  sourceId?: unknown;
  quote?: unknown;
}
export interface RequestSources {
  sources: (SourceReference & { text: string })[];
}

// 持久工具结果 schema 只检查 object/null，下列字段仍是外部原值。
export interface RawToolResult {
  truncated?: unknown;
  mode?: unknown;
  inspected?: unknown;
  actionId?: unknown;
  catalog?: unknown;
  status?: unknown;
  sourceType?: unknown;
}
// 保留原可选方法调用；损坏值仍在原调用处抛错，不补校验或替代方法。
export interface RawWriteArguments {
  noteId?: unknown;
  changes?: { map(callback: (change: { noteId?: unknown } | null | undefined) => unknown): unknown };
}
export interface RawAnswer {
  answer?: unknown;
  citations?: unknown;
}
export interface InitialSearchResult {
  hits?: Pick<import('./keyword-search.ts').SearchHit, 'noteId' | 'title' | 'ref' | 'text'>[];
  inspected?: number;
  truncated?: boolean;
  mode?: string;
  fallbackReason?: string;
}

/** 原持久工具结果不校验嵌套字段；在原解引用/方法调用处才声明对应操作视图。 */
export interface RawSearchResult {
  hits?: unknown;
  inspected?: unknown;
  truncated?: unknown;
  mode?: unknown;
  fallbackReason?: unknown;
}
export interface WorkerToolOutcome {
  sourceRefs: SourceReference[];
  truncated: boolean;
  fallback: boolean;
  inspected: unknown;
  actionId?: unknown;
  catalog?: boolean;
  progress?: boolean;
  external?: { hits: unknown } | null;
  errorCode?: string;
  hint?: string;
}
