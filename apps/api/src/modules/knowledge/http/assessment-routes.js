import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';

const decode = value => decodeURIComponent(value);

export async function handleAssessmentRoute({ request, response, url, knowledge }) {
  const profileRoot = '/api/knowledge/exam-profiles';
  if (request.method === 'GET' && url.pathname === profileRoot) {
    const query = toQueryObject(url);
    const data =
      query.view === 'workspace'
        ? await knowledge.listWorkspaceExamProfiles(query)
        : await knowledge.listExamProfiles(query);
    sendJson(response, 200, { data });
    return true;
  }
  if (request.method === 'POST' && url.pathname === profileRoot) {
    sendJson(response, 201, { data: await knowledge.createExamProfile(await parseBody(request)) });
    return true;
  }
  const lifecycle = url.pathname.match(
    /^\/api\/knowledge\/(exam-profiles|exam-focuses|questions)\/([^/]+)\/(purge-preview|trash|restore-deleted|purge)$/
  );
  if (lifecycle) {
    const type = { 'exam-profiles': 'examProfile', 'exam-focuses': 'examFocus', questions: 'question' }[lifecycle[1]];
    const params = { type, id: decode(lifecycle[2]) };
    if (request.method === 'GET' && lifecycle[3] === 'purge-preview')
      sendJson(response, 200, { data: await knowledge.inspectTrainingAssetPurge(params) });
    else if (request.method === 'POST' && lifecycle[3] === 'trash')
      sendJson(response, 200, { data: await knowledge.trashTrainingAsset(params) });
    else if (request.method === 'POST' && lifecycle[3] === 'restore-deleted')
      sendJson(response, 200, { data: await knowledge.restoreDeletedTrainingAsset(params) });
    else if (request.method === 'POST' && lifecycle[3] === 'purge')
      sendJson(response, 200, {
        data: await knowledge.permanentlyDeleteTrainingAsset(params, await parseBody(request))
      });
    else return false;
    return true;
  }
  const profileFocus = url.pathname.match(/^\/api\/knowledge\/exam-profiles\/([^/]+)\/focuses$/);
  if (profileFocus) {
    const examProfileId = decode(profileFocus[1]);
    if (request.method === 'GET') {
      sendJson(response, 200, { data: await knowledge.listExamFocuses({ ...toQueryObject(url), examProfileId }) });
      return true;
    }
    if (request.method === 'POST') {
      sendJson(response, 201, {
        data: await knowledge.createExamFocus({
          .../** @type {Record<string, unknown>} */ (await parseBody(request)),
          examProfileId
        })
      });
      return true;
    }
  }
  if (url.pathname === '/api/knowledge/exam-focuses') {
    if (request.method === 'GET') {
      sendJson(response, 200, { data: await knowledge.listExamFocuses(toQueryObject(url)) });
      return true;
    }
    if (request.method === 'POST') {
      sendJson(response, 201, { data: await knowledge.createExamFocus(await parseBody(request)) });
      return true;
    }
  }
  const profileAction = url.pathname.match(/^\/api\/knowledge\/exam-profiles\/([^/]+)\/(archive|restore)$/);
  if (profileAction && request.method === 'POST') {
    const params = { id: decode(profileAction[1]) };
    sendJson(response, 200, {
      data:
        profileAction[2] === 'archive'
          ? await knowledge.archiveExamProfile(params)
          : await knowledge.restoreExamProfile(params)
    });
    return true;
  }
  const profileDetail = url.pathname.match(/^\/api\/knowledge\/exam-profiles\/([^/]+)$/);
  if (profileDetail) {
    const params = { id: decode(profileDetail[1]) };
    if (request.method === 'GET') {
      sendJson(response, 200, { data: await knowledge.getExamProfile(params) });
      return true;
    }
    if (request.method === 'PATCH') {
      sendJson(response, 200, { data: await knowledge.updateExamProfile(params, await parseBody(request)) });
      return true;
    }
  }

  const focusAction = url.pathname.match(/^\/api\/knowledge\/exam-focuses\/([^/]+)\/(confirm|archive|restore)$/);
  if (focusAction && request.method === 'POST') {
    const params = { id: decode(focusAction[1]) };
    const action = focusAction[2];
    const result =
      action === 'confirm'
        ? await knowledge.confirmExamFocus(params)
        : action === 'archive'
          ? await knowledge.archiveExamFocus(params)
          : await knowledge.restoreExamFocus(params);
    sendJson(response, 200, { data: result });
    return true;
  }
  const focusDetail = url.pathname.match(/^\/api\/knowledge\/exam-focuses\/([^/]+)$/);
  if (focusDetail) {
    const params = { id: decode(focusDetail[1]) };
    if (request.method === 'GET') {
      sendJson(response, 200, { data: await knowledge.getExamFocus(params) });
      return true;
    }
    if (request.method === 'PATCH') {
      sendJson(response, 200, { data: await knowledge.updateExamFocus(params, await parseBody(request)) });
      return true;
    }
  }

  const questionRoot = '/api/knowledge/questions';
  if (request.method === 'GET' && url.pathname === questionRoot) {
    const query = toQueryObject(url);
    const data =
      query.view === 'workspace' ? await knowledge.listWorkspaceQuestions(query) : await knowledge.listQuestions(query);
    sendJson(response, 200, { data });
    return true;
  }
  if (request.method === 'POST' && url.pathname === questionRoot) {
    sendJson(response, 201, { data: await knowledge.createQuestion(await parseBody(request)) });
    return true;
  }
  const questionAction = url.pathname.match(
    /^\/api\/knowledge\/questions\/([^/]+)\/(validate|submit-review|confirm|archive|restore)$/
  );
  if (questionAction && request.method === 'POST') {
    const params = { id: decode(questionAction[1]) };
    const action = questionAction[2];
    const result =
      action === 'validate'
        ? await knowledge.validateQuestion(params)
        : action === 'submit-review'
          ? await knowledge.submitQuestionForReview(params)
          : action === 'confirm'
            ? await knowledge.confirmQuestion(params)
            : action === 'archive'
              ? await knowledge.archiveQuestion(params)
              : await knowledge.restoreQuestion(params);
    sendJson(response, 200, { data: result });
    return true;
  }
  const questionDetail = url.pathname.match(/^\/api\/knowledge\/questions\/([^/]+)$/);
  if (!questionDetail) return false;
  const params = { id: decode(questionDetail[1]) };
  if (request.method === 'GET') sendJson(response, 200, { data: await knowledge.getQuestion(params) });
  else if (request.method === 'PATCH')
    sendJson(response, 200, { data: await knowledge.updateQuestion(params, await parseBody(request)) });
  else return false;
  return true;
}
