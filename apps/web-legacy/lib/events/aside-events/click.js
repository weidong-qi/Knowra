import { closestFromEventTarget } from '../../dom/event-target.js';

export function bindAsideContentClickEvents({ state, elements, deps }) {
  elements.asideContent?.addEventListener('click', (event) => {
    if (closestFromEventTarget(event.target, '[data-attachment-rename-cancel]')) {
      deps.cancelAttachmentRename?.();
      return;
    }
    if (closestFromEventTarget(event.target, '[data-note-tag-toggle]')) {
      state.noteTagComposer.isExpanded = !state.noteTagComposer.isExpanded;
      if (!state.noteTagComposer.isExpanded) state.noteTagComposer.draft = '';
      deps.renderSidebar(deps.getCurrentNote(), {
        selector: state.noteTagComposer.isExpanded
          ? '[data-note-tag-input]'
          : '[data-note-tag-toggle]'
      });
      return;
    }
    const outlineToggle = closestFromEventTarget(event.target, '[data-outline-toggle-id]');
    if (outlineToggle?.dataset.outlineToggleId) {
      deps.toggleOutlineHeading?.(
        outlineToggle.dataset.outlineNoteId ?? '',
        outlineToggle.dataset.outlineToggleId
      );
      return;
    }
    const outlineItem = closestFromEventTarget(event.target, '[data-outline-id]');
    if (outlineItem?.dataset.outlineId) {
      const outlineIndex = Number.parseInt(outlineItem.dataset.outlineIndex ?? '', 10);
      deps.jumpToOutlineHeading?.(
        outlineItem.dataset.outlineId,
        Number.isInteger(outlineIndex) ? outlineIndex : -1
      );
      return;
    }
    const addTag = closestFromEventTarget(event.target, '[data-note-tag-add]');
    if (addTag?.dataset.noteTagAdd) {
      return void deps.addTagToCurrentNote(addTag.dataset.noteTagAdd)
        .then(() => deps.renderSidebar(deps.getCurrentNote(), { selector: '[data-note-tag-input]' }));
    }
    const removeTag = closestFromEventTarget(event.target, '[data-note-tag-remove]');
    if (removeTag?.dataset.noteTagRemove) {
      return void deps.removeTagFromCurrentNote(removeTag.dataset.noteTagRemove)
        .then(() => deps.renderSidebar(deps.getCurrentNote(), {
          selector: state.noteTagComposer.isExpanded
            ? '[data-note-tag-input]'
            : '[data-note-tag-toggle]'
        }));
    }
    if (closestFromEventTarget(event.target, '[data-note-tag-create]')) {
      return void deps.createTagAndAssignToCurrentNote(state.noteTagComposer.draft);
    }
    const annotationJump = closestFromEventTarget(event.target, '[data-annotation-jump]');
    if (annotationJump?.dataset.annotationJump) return void deps.selectAnnotation(annotationJump.dataset.annotationJump);
    const annotationDelete = closestFromEventTarget(event.target, '[data-annotation-delete]');
    if (annotationDelete?.dataset.annotationDelete) return void deps.deleteAnnotation(annotationDelete.dataset.annotationDelete);
    const knowledgeItemFromAnnotation = closestFromEventTarget(event.target, '[data-knowledge-item-from-annotation]');
    if (knowledgeItemFromAnnotation?.dataset.knowledgeItemFromAnnotation) {
      return void deps.createKnowledgeItemFromAnnotation(knowledgeItemFromAnnotation.dataset.knowledgeItemFromAnnotation);
    }
    const knowledgeItemOpen = closestFromEventTarget(event.target, '[data-knowledge-item-open]');
    if (knowledgeItemOpen?.dataset.knowledgeItemOpen) {
      return void deps.openKnowledge?.('items', knowledgeItemOpen.dataset.knowledgeItemOpen);
    }
    const objectiveOpen = closestFromEventTarget(event.target, '[data-learning-objective-open]');
    if (objectiveOpen?.dataset.learningObjectiveOpen) {
      return void deps.openKnowledge?.('objectives', objectiveOpen.dataset.learningObjectiveOpen);
    }
    const questionOpen = closestFromEventTarget(event.target, '[data-question-open]');
    if (questionOpen?.dataset.questionOpen) {
      return void deps.openTraining?.('questions', questionOpen.dataset.questionOpen);
    }
    const knowledgeItemSave = closestFromEventTarget(event.target, '[data-knowledge-item-save]');
    if (knowledgeItemSave?.dataset.knowledgeItemSave) {
      const card = closestFromEventTarget(event.target, '[data-knowledge-item-id]');
      const title = card?.querySelector('[data-knowledge-item-title]')?.value ?? '';
      const canonicalStatement = card?.querySelector('[data-knowledge-item-statement]')?.value ?? '';
      return void deps.updateKnowledgeItem(knowledgeItemSave.dataset.knowledgeItemSave, { title, canonicalStatement });
    }
    const knowledgeSourceAnnotation = closestFromEventTarget(event.target, '[data-knowledge-source-annotation]');
    if (knowledgeSourceAnnotation?.dataset.knowledgeSourceAnnotation) {
      return void deps.selectAnnotation(knowledgeSourceAnnotation.dataset.knowledgeSourceAnnotation);
    }
    const knowledgeItemConfirm = closestFromEventTarget(event.target, '[data-knowledge-item-confirm]');
    if (knowledgeItemConfirm?.dataset.knowledgeItemConfirm) {
      return void deps.confirmKnowledgeItem(knowledgeItemConfirm.dataset.knowledgeItemConfirm);
    }
    const knowledgeItemArchive = closestFromEventTarget(event.target, '[data-knowledge-item-archive]');
    if (knowledgeItemArchive?.dataset.knowledgeItemArchive) {
      return void deps.archiveKnowledgeItem(knowledgeItemArchive.dataset.knowledgeItemArchive);
    }
    const knowledgeItemRestore = closestFromEventTarget(event.target, '[data-knowledge-item-restore]');
    if (knowledgeItemRestore?.dataset.knowledgeItemRestore) {
      return void deps.restoreKnowledgeItem(knowledgeItemRestore.dataset.knowledgeItemRestore);
    }
    const objectiveAdd = closestFromEventTarget(event.target, '[data-learning-objective-add]');
    if (objectiveAdd?.dataset.learningObjectiveAdd) return void deps.createLearningObjective(objectiveAdd.dataset.learningObjectiveAdd);
    const objectiveSave = closestFromEventTarget(event.target, '[data-learning-objective-save]');
    if (objectiveSave?.dataset.learningObjectiveSave) {
      const card = closestFromEventTarget(event.target, '[data-learning-objective-id]');
      return void deps.updateLearningObjective(objectiveSave.dataset.learningObjectiveSave, {
        objective: card?.querySelector('[data-learning-objective-text]')?.value ?? '',
        actionVerb: card?.querySelector('[data-learning-objective-action]')?.value ?? '',
        cognitiveLevel: card?.querySelector('[data-learning-objective-cognitive]')?.value ?? ''
      });
    }
    const objectiveConfirm = closestFromEventTarget(event.target, '[data-learning-objective-confirm]');
    if (objectiveConfirm?.dataset.learningObjectiveConfirm) return void deps.confirmLearningObjective(objectiveConfirm.dataset.learningObjectiveConfirm);
    const objectiveArchive = closestFromEventTarget(event.target, '[data-learning-objective-archive]');
    if (objectiveArchive?.dataset.learningObjectiveArchive) return void deps.archiveLearningObjective(objectiveArchive.dataset.learningObjectiveArchive);
    const objectiveRestore = closestFromEventTarget(event.target, '[data-learning-objective-restore]');
    if (objectiveRestore?.dataset.learningObjectiveRestore) return void deps.restoreLearningObjective(objectiveRestore.dataset.learningObjectiveRestore);
    const questionAdd = closestFromEventTarget(event.target, '[data-question-add]');
    if (questionAdd?.dataset.questionAdd) return void deps.createQuestion(questionAdd.dataset.questionAdd);
    const questionSave = closestFromEventTarget(event.target, '[data-question-save]');
    if (questionSave?.dataset.questionSave) {
      const card = closestFromEventTarget(event.target, '[data-question-id]');
      return void deps.updateQuestion(questionSave.dataset.questionSave, {
        questionType: card?.querySelector('[data-question-type]')?.value ?? 'shortAnswer',
        stem: card?.querySelector('[data-question-stem]')?.value ?? '',
        referenceAnswer: card?.querySelector('[data-question-answer]')?.value ?? '',
        explanation: card?.querySelector('[data-question-explanation]')?.value ?? ''
      });
    }
    const questionValidate = closestFromEventTarget(event.target, '[data-question-validate]');
    if (questionValidate?.dataset.questionValidate) return void deps.validateQuestion(questionValidate.dataset.questionValidate);
    const questionConfirm = closestFromEventTarget(event.target, '[data-question-confirm]');
    if (questionConfirm?.dataset.questionConfirm) return void deps.confirmQuestion(questionConfirm.dataset.questionConfirm);
    const questionArchive = closestFromEventTarget(event.target, '[data-question-archive]');
    if (questionArchive?.dataset.questionArchive) return void deps.archiveQuestion(questionArchive.dataset.questionArchive);
    const questionRestore = closestFromEventTarget(event.target, '[data-question-restore]');
    if (questionRestore?.dataset.questionRestore) return void deps.restoreQuestion(questionRestore.dataset.questionRestore);
    const linked = closestFromEventTarget(event.target, '[data-linked-id]');
    if (linked?.dataset.linkedId) return void deps.selectNote(linked.dataset.linkedId, { syncFolder: true });
    const attachment = closestFromEventTarget(event.target, '[data-attachment-open]');
    if (attachment?.dataset.attachmentOpen) void deps.openAttachment?.(attachment.dataset.attachmentOpen);
  });
}
