import type { HttpInput } from './handler-input-types.ts';
import type { IncomingMessage } from 'node:http';
import type { ResponseWriter } from '../../../http/response.ts';
import type { createKnowledgeHttpHandlers } from './knowledge-handlers.ts';
import type { createPostgresKnowledgeHttpHandlers } from './postgres-async-handlers.ts';
type AssessmentRouteKnowledge = Pick<
  ReturnType<typeof createKnowledgeHttpHandlers> | ReturnType<typeof createPostgresKnowledgeHttpHandlers>,
  | 'archiveExamFocus'
  | 'archiveExamProfile'
  | 'archiveQuestion'
  | 'confirmExamFocus'
  | 'confirmQuestion'
  | 'createExamFocus'
  | 'createExamProfile'
  | 'createQuestion'
  | 'getExamFocus'
  | 'getExamProfile'
  | 'getQuestion'
  | 'inspectTrainingAssetPurge'
  | 'listExamFocuses'
  | 'listExamProfiles'
  | 'listQuestions'
  | 'listWorkspaceExamProfiles'
  | 'listWorkspaceQuestions'
  | 'permanentlyDeleteTrainingAsset'
  | 'restoreDeletedTrainingAsset'
  | 'restoreExamFocus'
  | 'restoreExamProfile'
  | 'restoreQuestion'
  | 'submitQuestionForReview'
  | 'trashTrainingAsset'
  | 'updateExamFocus'
  | 'updateExamProfile'
  | 'updateQuestion'
  | 'validateQuestion'
>;
export interface AssessmentRouteContext {
  request: IncomingMessage;
  response: ResponseWriter;
  url: URL;
  knowledge: AssessmentRouteKnowledge;
}

import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';

const decode = (value: string) => decodeURIComponent(value);

export async function handleAssessmentRoute({
  request,
  response,
  url,
  knowledge
}: AssessmentRouteContext): Promise<boolean> {
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
    sendJson(response, 201, {
      data: await knowledge.createExamProfile((await parseBody(request)) as HttpInput)
    });
    return true;
  }
  const lifecycle = url.pathname.match(
    /^\/api\/knowledge\/(exam-profiles|exam-focuses|questions)\/([^/]+)\/(purge-preview|trash|restore-deleted|purge)$/
  );
  if (lifecycle) {
    const type = { 'exam-profiles': 'examProfile', 'exam-focuses': 'examFocus', questions: 'question' }[lifecycle[1]];
    const params = { type, id: decode(lifecycle[2]) };
    if (request.method === 'GET' && lifecycle[3] === 'purge-preview')
      sendJson(response, 200, {
        data: await knowledge.inspectTrainingAssetPurge(
          params as Parameters<typeof knowledge.inspectTrainingAssetPurge>[0]
        )
      });
    else if (request.method === 'POST' && lifecycle[3] === 'trash')
      sendJson(response, 200, {
        data: await knowledge.trashTrainingAsset(params as Parameters<typeof knowledge.trashTrainingAsset>[0])
      });
    else if (request.method === 'POST' && lifecycle[3] === 'restore-deleted')
      sendJson(response, 200, {
        data: await knowledge.restoreDeletedTrainingAsset(
          params as Parameters<typeof knowledge.restoreDeletedTrainingAsset>[0]
        )
      });
    else if (request.method === 'POST' && lifecycle[3] === 'purge')
      sendJson(response, 200, {
        data: await knowledge.permanentlyDeleteTrainingAsset(
          params as Parameters<typeof knowledge.permanentlyDeleteTrainingAsset>[0],
          (await parseBody(request)) as HttpInput
        )
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
          ...((await parseBody(request)) as Record<string, unknown>),
          examProfileId
        } as HttpInput)
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
      sendJson(response, 201, {
        data: await knowledge.createExamFocus((await parseBody(request)) as HttpInput)
      });
      return true;
    }
  }
  const profileAction = url.pathname.match(/^\/api\/knowledge\/exam-profiles\/([^/]+)\/(archive|restore)$/);
  if (profileAction && request.method === 'POST') {
    const params = { id: decode(profileAction[1]) };
    sendJson(response, 200, {
      data:
        profileAction[2] === 'archive'
          ? await knowledge.archiveExamProfile(params as Parameters<typeof knowledge.archiveExamProfile>[0])
          : await knowledge.restoreExamProfile(params as Parameters<typeof knowledge.restoreExamProfile>[0])
    });
    return true;
  }
  const profileDetail = url.pathname.match(/^\/api\/knowledge\/exam-profiles\/([^/]+)$/);
  if (profileDetail) {
    const params = { id: decode(profileDetail[1]) };
    if (request.method === 'GET') {
      sendJson(response, 200, {
        data: await knowledge.getExamProfile(params as Parameters<typeof knowledge.getExamProfile>[0])
      });
      return true;
    }
    if (request.method === 'PATCH') {
      sendJson(response, 200, {
        data: await knowledge.updateExamProfile(
          params as Parameters<typeof knowledge.updateExamProfile>[0],
          (await parseBody(request)) as HttpInput
        )
      });
      return true;
    }
  }

  const focusAction = url.pathname.match(/^\/api\/knowledge\/exam-focuses\/([^/]+)\/(confirm|archive|restore)$/);
  if (focusAction && request.method === 'POST') {
    const params = { id: decode(focusAction[1]) };
    const action = focusAction[2];
    const result =
      action === 'confirm'
        ? await knowledge.confirmExamFocus(params as Parameters<typeof knowledge.confirmExamFocus>[0])
        : action === 'archive'
          ? await knowledge.archiveExamFocus(params as Parameters<typeof knowledge.archiveExamFocus>[0])
          : await knowledge.restoreExamFocus(params as Parameters<typeof knowledge.restoreExamFocus>[0]);
    sendJson(response, 200, { data: result });
    return true;
  }
  const focusDetail = url.pathname.match(/^\/api\/knowledge\/exam-focuses\/([^/]+)$/);
  if (focusDetail) {
    const params = { id: decode(focusDetail[1]) };
    if (request.method === 'GET') {
      sendJson(response, 200, {
        data: await knowledge.getExamFocus(params as Parameters<typeof knowledge.getExamFocus>[0])
      });
      return true;
    }
    if (request.method === 'PATCH') {
      sendJson(response, 200, {
        data: await knowledge.updateExamFocus(
          params as Parameters<typeof knowledge.updateExamFocus>[0],
          (await parseBody(request)) as HttpInput
        )
      });
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
    sendJson(response, 201, {
      data: await knowledge.createQuestion((await parseBody(request)) as HttpInput)
    });
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
        ? await knowledge.validateQuestion(params as Parameters<typeof knowledge.validateQuestion>[0])
        : action === 'submit-review'
          ? await knowledge.submitQuestionForReview(params as Parameters<typeof knowledge.submitQuestionForReview>[0])
          : action === 'confirm'
            ? await knowledge.confirmQuestion(params as Parameters<typeof knowledge.confirmQuestion>[0])
            : action === 'archive'
              ? await knowledge.archiveQuestion(params as Parameters<typeof knowledge.archiveQuestion>[0])
              : await knowledge.restoreQuestion(params as Parameters<typeof knowledge.restoreQuestion>[0]);
    sendJson(response, 200, { data: result });
    return true;
  }
  const questionDetail = url.pathname.match(/^\/api\/knowledge\/questions\/([^/]+)$/);
  if (!questionDetail) return false;
  const params = { id: decode(questionDetail[1]) };
  if (request.method === 'GET')
    sendJson(response, 200, {
      data: await knowledge.getQuestion(params as Parameters<typeof knowledge.getQuestion>[0])
    });
  else if (request.method === 'PATCH')
    sendJson(response, 200, {
      data: await knowledge.updateQuestion(
        params as Parameters<typeof knowledge.updateQuestion>[0],
        (await parseBody(request)) as HttpInput
      )
    });
  else return false;
  return true;
}
