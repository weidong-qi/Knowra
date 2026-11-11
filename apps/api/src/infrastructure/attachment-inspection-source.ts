import { TokenType } from '@streamparser/json';
import { createAppError } from '../errors/app-error.ts';
import { readJsonFileSync } from './json-file-reader.ts';
import { LOCAL_DATA_COLLECTIONS, validatePersistedLocalState } from './local-data-schema.ts';
import type { PathLike } from 'node:fs';

type InspectionScope = 'direct' | 'wrapped';
interface InspectionFrame {
  object: boolean;
  expectKey: boolean;
  expectValue: boolean;
  key: string | undefined;
  scope: InspectionScope | null;
}

const retained = ['schemaVersion', 'spaces', 'folders', 'tags', 'tagGroups', 'notes', 'attachments'];
const paths = retained.flatMap(key => [`$.${key}`, `$.data.${key}`]);
const collectionNames = new Set(LOCAL_DATA_COLLECTIONS);

// 发布检查只验证附件及其当前归属。历史正文、标注修订、AI 与同步快照不装入内存；
// 整个文件仍须是合法 JSON，集合结构仍须合法。完整领域引用由 API 启动校验负责。
export function readAttachmentInspectionSource(filePath: PathLike) {
  const documents: Record<InspectionScope, Record<string, unknown>> = { direct: {}, wrapped: {} },
    types: Record<InspectionScope, Record<string, TokenType>> = { direct: {}, wrapped: {} };
  const frames: InspectionFrame[] = [];
  let rootType: TokenType | undefined,
    wrapper: 'object' | 'invalid' | null = null;
  readJsonFileSync(filePath, {
    paths,
    onValue({ value, key, stack }) {
      const scope = stack.length === 1 ? 'direct' : stack.length === 2 && stack[1].key === 'data' ? 'wrapped' : null;
      if (scope)
        Object.defineProperty(documents[scope], key as PropertyKey, {
          value,
          enumerable: true,
          writable: true,
          configurable: true
        });
    },
    onToken({ token, value }) {
      const frame = frames.at(-1);
      if (rootType === undefined) rootType = token;
      if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) {
        frames.pop();
        return;
      }
      if (token === TokenType.COMMA) {
        if (frame?.object) frame.expectKey = true;
        return;
      }
      if (token === TokenType.COLON) {
        if (frame) frame.expectValue = true;
        return;
      }
      if (token === TokenType.STRING && frame?.object && frame.expectKey) {
        frame.key = value as string;
        frame.expectKey = false;
        return;
      }
      const field = frame?.expectValue ? frame.key : undefined;
      if (frame?.scope && field !== undefined && collectionNames.has(field)) types[frame.scope][field] = token;
      const isWrapper = frame?.scope === 'direct' && field === 'data';
      if (isWrapper) {
        wrapper = token === TokenType.NULL ? null : token === TokenType.LEFT_BRACE ? 'object' : 'invalid';
        documents.wrapped = {};
        types.wrapped = {};
      }
      if (frame) frame.expectValue = false;
      if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
        frames.push({
          object: token === TokenType.LEFT_BRACE,
          expectKey: token === TokenType.LEFT_BRACE,
          expectValue: false,
          key: undefined,
          scope: frames.length === 0 ? 'direct' : isWrapper && wrapper === 'object' ? 'wrapped' : null
        });
      }
    }
  });
  if (rootType !== TokenType.LEFT_BRACE || wrapper === 'invalid') invalid('Local data file must contain an object');
  const scope = wrapper === 'object' ? 'wrapped' : 'direct';
  for (const [collection, type] of Object.entries(types[scope])) {
    if (type !== TokenType.LEFT_BRACKET) invalid(`${collection} must be an array`);
  }
  return validatePersistedLocalState(documents[scope]);
}

function invalid(message: string): never {
  throw createAppError('STORAGE_SNAPSHOT_INVALID', message, 422);
}
