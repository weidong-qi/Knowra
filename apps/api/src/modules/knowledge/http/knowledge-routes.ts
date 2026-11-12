type KnowledgeRouteContext = Parameters<typeof handleFolderRoute>[0] &
  Parameters<typeof handleContentAnnotationRoute>[0] &
  Parameters<typeof handleNoteRoute>[0] &
  Parameters<typeof handleSpaceRoute>[0] &
  Parameters<typeof handleTagRoute>[0] &
  Parameters<typeof handleNoteVersionRoute>[0] &
  Parameters<typeof handleKnowledgeItemRoute>[0] &
  Parameters<typeof handleLearningObjectiveRoute>[0] &
  Parameters<typeof handleAssessmentRoute>[0] &
  Parameters<typeof handleWorkspaceRoute>[0];
import { handleFolderRoute } from './folder-routes.ts';
import { handleContentAnnotationRoute } from './content-annotation-routes.ts';
import { handleNoteRoute } from './note-routes.ts';
import { handleSpaceRoute } from './space-routes.ts';
import { handleTagRoute } from './tag-routes.ts';
import { handleNoteVersionRoute } from './note-version-routes.ts';
import { handleKnowledgeItemRoute } from './knowledge-item-routes.ts';
import { handleLearningObjectiveRoute } from './learning-objective-routes.ts';
import { handleAssessmentRoute } from './assessment-routes.ts';
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

export async function handleKnowledgeRoute(context: KnowledgeRouteContext): Promise<boolean> {
  for (const handler of knowledgeRouteHandlers) {
    if (await handler(context)) {
      return true;
    }
  }

  return false;
}
