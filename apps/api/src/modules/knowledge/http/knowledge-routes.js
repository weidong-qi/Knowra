import { handleFolderRoute } from './folder-routes.ts';
import { handleContentAnnotationRoute } from './content-annotation-routes.ts';
import { handleNoteRoute } from './note-routes.js';
import { handleSpaceRoute } from './space-routes.ts';
import { handleTagRoute } from './tag-routes.ts';
import { handleNoteVersionRoute } from './note-version-routes.ts';
import { handleKnowledgeItemRoute } from './knowledge-item-routes.js';
import { handleLearningObjectiveRoute } from './learning-objective-routes.ts';
import { handleAssessmentRoute } from './assessment-routes.js';
import { handleWorkspaceRoute } from './workspace-routes.ts';

const knowledgeRouteHandlers = [
  handleWorkspaceRoute,
  handleAssessmentRoute,
  handleLearningObjectiveRoute,
  handleKnowledgeItemRoute,
  handleNoteVersionRoute,
  handleContentAnnotationRoute,
  handleNoteRoute,
  handleFolderRoute,
  handleTagRoute,
  handleSpaceRoute
];

export async function handleKnowledgeRoute(context) {
  for (const handler of knowledgeRouteHandlers) {
    if (await handler(context)) {
      return true;
    }
  }

  return false;
}
