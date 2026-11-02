import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { createAppError } from '../../errors/app-error.js';

export async function handleAiFeatureRoute({ request, response, url, features }) {
  if (url.pathname !== '/api/ai/features' || !features) return false;
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET') {
    sendJson(response, 200, { data: await features.get() });
    return true;
  }
  if (request.method === 'PUT') {
    if (request.headers['x-knowra-ai-features'] !== '1') {
      throw createAppError('AI_FEATURES_REQUEST_REJECTED', 'AI 功能开关请求无效。', 403);
    }
    sendJson(response, 200, { data: await features.set(await parseBody(request, { limitBytes: 256 })) });
    return true;
  }
  return false;
}
