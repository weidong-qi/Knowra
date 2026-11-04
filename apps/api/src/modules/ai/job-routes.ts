import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { extractionHttpError } from './knowledge-extraction-http-errors.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createKnowledgeExtractionHttpService } from './knowledge-extraction-http-service.ts';

interface ExtractionJobRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  extraction: Pick<
    ReturnType<typeof createKnowledgeExtractionHttpService>,
    'capabilities' | 'list' | 'get' | 'start' | 'cancel' | 'retry'
  >;
}
interface ExtractionRoutePageInput {
  spaceId: string | null;
  cursor?: string | null;
  idempotencyKey?: string | null;
  limit?: number;
}

const invalid: () => never = () => {
  throw extractionHttpError({ code: 'KNOWLEDGE_EXTRACTION_REQUEST_INVALID' });
};
const object = (value: unknown): value is Record<string, unknown> =>
  (value && typeof value === 'object' && !Array.isArray(value)) as boolean;

export async function handleAiJobRoute({ request, response, url, extraction }: ExtractionJobRouteContext) {
  const root = '/api/ai/jobs';
  const capability = url.pathname === '/api/ai/capabilities';
  const match = url.pathname.match(/^\/api\/ai\/jobs\/([^/]+)(?:\/(cancel|retry))?$/);
  if (!capability && url.pathname !== root && !match) return false;
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET' && capability) {
    sendJson(response, 200, { data: await extraction.capabilities() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === root) {
    const allowed = ['kind', 'spaceId', 'limit', 'cursor', 'idempotencyKey'];
    if (
      [...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1) ||
      url.searchParams.get('kind') !== 'knowledgeExtraction'
    )
      invalid();
    const input: ExtractionRoutePageInput = { spaceId: url.searchParams.get('spaceId') };
    for (const key of ['cursor', 'idempotencyKey'])
      if (url.searchParams.has(key)) input[key as 'cursor' | 'idempotencyKey'] = url.searchParams.get(key);
    if (url.searchParams.has('limit')) {
      const value = url.searchParams.get('limit');
      if (!/^[1-9][0-9]?$/.test(value as string)) invalid();
      input.limit = Number(value);
    }
    sendJson(response, 200, { data: await extraction.list(input) });
    return true;
  }
  let jobId!: string;
  if (match) {
    try {
      jobId = decodeURIComponent(match[1]);
    } catch {
      invalid();
    }
    if (url.search) invalid();
  }
  if (request.method === 'GET' && match && !match[2]) {
    sendJson(response, 200, { data: await extraction.get(jobId) });
    return true;
  }
  if (request.method !== 'POST' || capability || (match && !match[2])) return false;
  if (url.search) invalid();
  if (request.headers['x-knowra-ai-job'] !== '1') {
    throw extractionHttpError({ code: 'KNOWLEDGE_EXTRACTION_REQUEST_REJECTED' });
  }
  const input = await parseBody(request, { limitBytes: 2048 });
  if (url.pathname === root) {
    if (
      !object(input) ||
      Object.keys(input).length !== 3 ||
      input.kind !== 'knowledgeExtraction' ||
      !Object.hasOwn(input, 'scopeId') ||
      !Object.hasOwn(input, 'idempotencyKey')
    )
      invalid();
    sendJson(response, 202, {
      data: await extraction.start({ scopeId: input.scopeId, idempotencyKey: input.idempotencyKey })
    });
    return true;
  }
  if (!object(input) || Object.keys(input).length) invalid();
  const data = await extraction[match![2] as 'cancel' | 'retry'](jobId);
  sendJson(response, match![2] === 'retry' ? 202 : 200, { data });
  return true;
}
