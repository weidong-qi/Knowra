import { normalizeCatalogSpec, catalogSpecsFromCalls } from '../src/modules/ai/catalog-tool.ts';
import {
  normalizeCatalogSpec as bridgeNormalize,
  catalogSpecsFromCalls as bridgeCalls
} from '../src/modules/ai/catalog-tool.js';
import type {
  CatalogArguments,
  CatalogCall,
  CatalogSpec,
  FolderCatalogSpec,
  NoteCatalogSpec
} from '../src/modules/ai/catalog-tool.ts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type NormalizerArguments = Assert<
  Equal<Parameters<typeof normalizeCatalogSpec>, [toolName: string, args: CatalogArguments | null | undefined]>
>;
export type NormalizerResult = Assert<Equal<ReturnType<typeof normalizeCatalogSpec>, CatalogSpec>>;
export type CallsArguments = Assert<
  Equal<Parameters<typeof catalogSpecsFromCalls>, [calls: Iterable<CatalogCall, unknown, unknown>]>
>;
export type CallsResult = Assert<Equal<ReturnType<typeof catalogSpecsFromCalls>, CatalogSpec[]>>;
export type BridgeNormalizer = Assert<Equal<typeof bridgeNormalize, typeof normalizeCatalogSpec>>;
export type BridgeCallCollector = Assert<Equal<typeof bridgeCalls, typeof catalogSpecsFromCalls>>;
export type FolderDiscriminant = Assert<Equal<Extract<CatalogSpec, { kind: 'folders' }>, FolderCatalogSpec>>;
export type NoteDiscriminant = Assert<Equal<Extract<CatalogSpec, { kind: 'notes' }>, NoteCatalogSpec>>;
// 用静态不兼容证明拒绝错误支持域，不使用 ignore、expect-error 或断言。
export type RejectStringLimit = Assert<Equal<{ limit: string } extends CatalogArguments ? true : false, false>>;
export type RejectNumericRecursive = Assert<
  Equal<{ recursive: number } extends CatalogArguments ? true : false, false>
>;
export type RejectNumericTool = Assert<
  Equal<{ toolName: number; status: string } extends CatalogCall ? true : false, false>
>;
export type RejectAsyncIterable = Assert<
  Equal<AsyncIterable<CatalogCall> extends Parameters<typeof catalogSpecsFromCalls>[0] ? true : false, false>
>;

const args: CatalogArguments = Object.freeze({ limit: null, offset: null, sortBy: 'unverified' });
const spec: CatalogSpec = normalizeCatalogSpec('notes_list', args);
if (spec.kind === 'notes') {
  const note: NoteCatalogSpec = spec;
  void note;
} else {
  const folder: FolderCatalogSpec = spec;
  void folder;
}
const calls: Iterable<CatalogCall, unknown, unknown> = (function* () {
  yield { toolName: 'notes_list', status: 'succeeded', argumentsJson: {} };
})();
const result: CatalogSpec[] = bridgeCalls(calls);
void result;
