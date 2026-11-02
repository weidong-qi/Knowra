import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { createAppError } from '../../errors/app-error.js';

export async function handleModelSettingsRoute({ request, response, url, modelSettings }) {
  if (!url.pathname.startsWith('/api/ai/model-settings') || !modelSettings) return false;
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET' && url.pathname === '/api/ai/model-settings') {
    sendJson(response, 200, { data: await modelSettings.status() });
    return true;
  }
  if (request.headers['x-knowra-model-settings'] !== '1') {
    throw createAppError('MODEL_SETTINGS_REQUEST_REJECTED', '模型设置请求无效。', 403);
  }
  if (request.method === 'PUT' && url.pathname === '/api/ai/model-settings') {
    sendJson(response, 200, { data: await modelSettings.save(await parseBody(request, { limitBytes: 2048 })) });
    return true;
  }
  if (request.method === 'DELETE' && url.pathname === '/api/ai/model-settings') {
    sendJson(response, 200, { data: await modelSettings.remove() });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/ai/model-settings/check') {
    sendJson(response, 200, { data: await modelSettings.check() });
    return true;
  }
  return false;
}
