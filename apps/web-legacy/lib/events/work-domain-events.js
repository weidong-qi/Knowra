import { closestFromEventTarget } from '../dom/event-target.js';

export function bindWorkDomainEvents({ state, elements, deps }) {
  const filterTimers = new Map();

  const scheduleFilter = (controller, name, value) => {
    const timer = filterTimers.get(name);
    if (timer) globalThis.clearTimeout(timer);
    const nextTimer = globalThis.setTimeout(() => {
      filterTimers.delete(name);
      controller?.setFilter(name, value);
    }, 180);
    filterTimers.set(name, nextTimer);
  };

  elements.workDomainView?.addEventListener('click', (event) => {
    const domainButton = closestFromEventTarget(event.target, '[data-work-domain-key]');
    if (domainButton?.dataset.workDomainKey) {
      event.preventDefault();
      deps.selectWorkDomain(domainButton.dataset.workDomainKey);
      return;
    }

    const viewButton = closestFromEventTarget(event.target, '[data-work-domain-view]');
    if (viewButton?.dataset.workDomainView) {
      event.preventDefault();
      deps.selectWorkDomainView(viewButton.dataset.workDomainView);
      return;
    }

    if (closestFromEventTarget(event.target, '[data-workspace-retry]')) {
      event.preventDefault();
      void deps.retryWorkspace();
      return;
    }

    const knowledgeSelect = closestFromEventTarget(event.target, '[data-knowledge-select]');
    if (knowledgeSelect?.dataset.knowledgeSelect) {
      deps.selectKnowledgeItem(knowledgeSelect.dataset.knowledgeSelect);
      return;
    }
    const objectiveSelect = closestFromEventTarget(event.target, '[data-objective-select]');
    if (objectiveSelect?.dataset.objectiveSelect) {
      deps.selectLearningObjective(objectiveSelect.dataset.objectiveSelect);
      return;
    }
    const reviewSelect = closestFromEventTarget(event.target, '[data-review-select]');
    if (reviewSelect?.dataset.reviewSelect) {
      deps.selectReviewEntry(
        reviewSelect.dataset.reviewSelectKind,
        reviewSelect.dataset.reviewSelect
      );
      return;
    }
    const questionSelect = closestFromEventTarget(event.target, '[data-question-select]');
    if (questionSelect?.dataset.questionSelect) {
      deps.selectQuestion(questionSelect.dataset.questionSelect);
      return;
    }
    const profileSelect = closestFromEventTarget(event.target, '[data-profile-select]');
    if (profileSelect?.dataset.profileSelect) {
      deps.selectProfile(profileSelect.dataset.profileSelect);
      return;
    }

    if (closestFromEventTarget(event.target, '[data-knowledge-create]')) {
      void deps.createKnowledgeItem();
      return;
    }
    if (closestFromEventTarget(event.target, '[data-question-create]')) {
      void deps.createQuestion();
      return;
    }
    if (closestFromEventTarget(event.target, '[data-profile-create]')) {
      void deps.createProfile();
      return;
    }

    const openNote = closestFromEventTarget(event.target, '[data-open-note]');
    if (openNote?.dataset.openNote) {
      void deps.openNote(openNote.dataset.openNote);
      return;
    }
    const openKnowledge = closestFromEventTarget(event.target, '[data-open-knowledge-item]');
    if (openKnowledge?.dataset.openKnowledgeItem) {
      deps.openKnowledge('items', openKnowledge.dataset.openKnowledgeItem);
      return;
    }
    const openObjective = closestFromEventTarget(event.target, '[data-open-objective]');
    if (openObjective?.dataset.openObjective) {
      deps.selectLearningObjective(openObjective.dataset.openObjective);
      return;
    }
    const openQuestion = closestFromEventTarget(event.target, '[data-open-question]');
    if (openQuestion?.dataset.openQuestion) {
      deps.openTraining('questions', openQuestion.dataset.openQuestion);
      return;
    }
    const reviewOpen = closestFromEventTarget(event.target, '[data-review-open]');
    if (reviewOpen?.dataset.reviewOpen) {
      deps.openReviewEntry(reviewOpen.dataset.reviewOpenKind, reviewOpen.dataset.reviewOpen);
      return;
    }

    const knowledgeSave = closestFromEventTarget(event.target, '[data-knowledge-save]');
    if (knowledgeSave?.dataset.knowledgeSave) {
      const panel = closestFromEventTarget(event.target, '[data-inspector-kind="knowledgeItem"]');
      void deps.updateKnowledgeItem(knowledgeSave.dataset.knowledgeSave, {
        title: panel?.querySelector('[data-knowledge-inspector-field="title"]')?.value ?? '',
        canonicalStatement: panel?.querySelector('[data-knowledge-inspector-field="canonicalStatement"]')?.value ?? '',
        userExplanation: panel?.querySelector('[data-knowledge-inspector-field="userExplanation"]')?.value ?? ''
      });
      return;
    }
    const objectiveSave = closestFromEventTarget(event.target, '[data-objective-save]');
    if (objectiveSave?.dataset.objectiveSave) {
      const panel = closestFromEventTarget(event.target, '[data-inspector-kind="learningObjective"]');
      void deps.updateLearningObjective(objectiveSave.dataset.objectiveSave, {
        objective: panel?.querySelector('[data-objective-inspector-field="objective"]')?.value ?? '',
        actionVerb: panel?.querySelector('[data-objective-inspector-field="actionVerb"]')?.value ?? '',
        cognitiveLevel: panel?.querySelector('[data-objective-inspector-field="cognitiveLevel"]')?.value ?? '',
        difficultyHint: panel?.querySelector('[data-objective-inspector-field="difficultyHint"]')?.value || null
      });
      return;
    }

    if (handleKnowledgeAction(event, deps)) return;
    if (handleQuestionAction(event, deps, state)) return;
    if (handleProfileAction(event, deps)) return;
  });

  elements.workDomainView?.addEventListener('input', (event) => {
    const target = event.target;
    if (target?.matches?.('[data-knowledge-filter-query]')) {
      scheduleFilter(deps.knowledgeWorkspaceController, 'knowledge.query', target.value);
    } else if (target?.matches?.('[data-objective-filter-query]')) {
      scheduleFilter(deps.knowledgeWorkspaceController, 'objective.query', target.value);
    } else if (target?.matches?.('[data-question-filter-query]')) {
      scheduleFilter(deps.trainingWorkspaceController, 'training.query', target.value);
    }
  });

  elements.workDomainView?.addEventListener('change', (event) => {
    const target = event.target;
    const knowledgeFilter = target?.dataset?.knowledgeFilter;
    const objectiveFilter = target?.dataset?.objectiveFilter;
    const questionFilter = target?.dataset?.questionFilter;
    const booleanFilter = target?.dataset?.knowledgeFilterBoolean;
    const objectiveBoolean = target?.dataset?.objectiveFilterBoolean;
    if (knowledgeFilter) deps.knowledgeWorkspaceController.setFilter(knowledgeFilter, target.value);
    else if (objectiveFilter) deps.knowledgeWorkspaceController.setFilter(objectiveFilter, target.value);
    else if (questionFilter) deps.trainingWorkspaceController.setFilter(questionFilter, target.value);
    else if (booleanFilter) deps.knowledgeWorkspaceController.setFilter(booleanFilter, Boolean(target.checked));
    else if (objectiveBoolean) deps.knowledgeWorkspaceController.setFilter(objectiveBoolean, Boolean(target.checked));
  });
}

function handleKnowledgeAction(event, deps) {
  const confirm = closestFromEventTarget(event.target, '[data-knowledge-confirm]');
  if (confirm?.dataset.knowledgeConfirm) { void deps.confirmKnowledgeItem(confirm.dataset.knowledgeConfirm); return true; }
  const revision = closestFromEventTarget(event.target, '[data-knowledge-revision]');
  if (revision?.dataset.knowledgeRevision) { void deps.requestKnowledgeItemRevision(revision.dataset.knowledgeRevision); return true; }
  const archive = closestFromEventTarget(event.target, '[data-knowledge-archive]');
  if (archive?.dataset.knowledgeArchive) { void deps.archiveKnowledgeItem(archive.dataset.knowledgeArchive); return true; }
  const restore = closestFromEventTarget(event.target, '[data-knowledge-restore]');
  if (restore?.dataset.knowledgeRestore) { void deps.restoreKnowledgeItem(restore.dataset.knowledgeRestore); return true; }
  const createObjective = closestFromEventTarget(event.target, '[data-objective-create-for]');
  if (createObjective?.dataset.objectiveCreateFor) { void deps.createLearningObjective(createObjective.dataset.objectiveCreateFor); return true; }
  const objectiveConfirm = closestFromEventTarget(event.target, '[data-objective-confirm]');
  if (objectiveConfirm?.dataset.objectiveConfirm) { void deps.confirmLearningObjective(objectiveConfirm.dataset.objectiveConfirm); return true; }
  const objectiveRevision = closestFromEventTarget(event.target, '[data-objective-revision]');
  if (objectiveRevision?.dataset.objectiveRevision) { void deps.requestLearningObjectiveRevision(objectiveRevision.dataset.objectiveRevision); return true; }
  const objectiveArchive = closestFromEventTarget(event.target, '[data-objective-archive]');
  if (objectiveArchive?.dataset.objectiveArchive) { void deps.archiveLearningObjective(objectiveArchive.dataset.objectiveArchive); return true; }
  const objectiveRestore = closestFromEventTarget(event.target, '[data-objective-restore]');
  if (objectiveRestore?.dataset.objectiveRestore) { void deps.restoreLearningObjective(objectiveRestore.dataset.objectiveRestore); return true; }
  const createQuestion = closestFromEventTarget(event.target, '[data-create-question-from-objective]');
  if (createQuestion?.dataset.createQuestionFromObjective) { void deps.createQuestion(createQuestion.dataset.createQuestionFromObjective); return true; }
  return false;
}

function handleQuestionAction(event, deps, state) {
  const save = closestFromEventTarget(event.target, '[data-question-save-workspace]');
  if (save?.dataset.questionSaveWorkspace) {
    const panel = closestFromEventTarget(event.target, '[data-inspector-kind="question"]');
    void deps.updateQuestion(save.dataset.questionSaveWorkspace, readQuestionInput(panel));
    return true;
  }
  const addSource = closestFromEventTarget(event.target, '[data-question-source-add]');
  if (addSource) {
    deps.addQuestionSource(state.trainingWorkspace.selection.id);
    return true;
  }
  const removeSource = closestFromEventTarget(event.target, '[data-question-source-remove]');
  if (removeSource) {
    const row = closestFromEventTarget(event.target, '[data-question-source-row]');
    deps.removeQuestionSource(state.trainingWorkspace.selection.id, row?.dataset.questionSourceRow);
    return true;
  }
  const validate = closestFromEventTarget(event.target, '[data-question-validate-workspace]');
  if (validate?.dataset.questionValidateWorkspace) { void deps.validateQuestion(validate.dataset.questionValidateWorkspace); return true; }
  const submit = closestFromEventTarget(event.target, '[data-question-submit-workspace]');
  if (submit?.dataset.questionSubmitWorkspace) { void deps.submitQuestion(submit.dataset.questionSubmitWorkspace); return true; }
  const confirm = closestFromEventTarget(event.target, '[data-question-confirm-workspace]');
  if (confirm?.dataset.questionConfirmWorkspace) { void deps.confirmQuestion(confirm.dataset.questionConfirmWorkspace); return true; }
  const archive = closestFromEventTarget(event.target, '[data-question-archive-workspace]');
  if (archive?.dataset.questionArchiveWorkspace) { void deps.archiveQuestion(archive.dataset.questionArchiveWorkspace); return true; }
  const restore = closestFromEventTarget(event.target, '[data-question-restore-workspace]');
  if (restore?.dataset.questionRestoreWorkspace) { void deps.restoreQuestion(restore.dataset.questionRestoreWorkspace); return true; }
  return false;
}

function handleProfileAction(event, deps) {
  const save = closestFromEventTarget(event.target, '[data-profile-save]');
  if (save?.dataset.profileSave) {
    const panel = closestFromEventTarget(event.target, '[data-inspector-kind="profile"]');
    void deps.updateProfile(save.dataset.profileSave, {
      name: panel?.querySelector('[data-profile-field="name"]')?.value ?? '',
      description: panel?.querySelector('[data-profile-field="description"]')?.value ?? '',
      scope: (panel?.querySelector('[data-profile-field="scope"]')?.value ?? '').split('\n').map((value) => value.trim()).filter(Boolean)
    });
    return true;
  }
  const archive = closestFromEventTarget(event.target, '[data-profile-archive]');
  if (archive?.dataset.profileArchive) { void deps.archiveProfile(archive.dataset.profileArchive); return true; }
  const restore = closestFromEventTarget(event.target, '[data-profile-restore]');
  if (restore?.dataset.profileRestore) { void deps.restoreProfile(restore.dataset.profileRestore); return true; }
  const createFocus = closestFromEventTarget(event.target, '[data-focus-create]');
  if (createFocus?.dataset.focusCreate) { void deps.createFocus(createFocus.dataset.focusCreate); return true; }
  const confirmFocus = closestFromEventTarget(event.target, '[data-focus-confirm]');
  if (confirmFocus?.dataset.focusConfirm) { void deps.confirmFocus(confirmFocus.dataset.focusConfirm); return true; }
  const archiveFocus = closestFromEventTarget(event.target, '[data-focus-archive]');
  if (archiveFocus?.dataset.focusArchive) { void deps.archiveFocus(archiveFocus.dataset.focusArchive); return true; }
  const restoreFocus = closestFromEventTarget(event.target, '[data-focus-restore]');
  if (restoreFocus?.dataset.focusRestore) { void deps.restoreFocus(restoreFocus.dataset.focusRestore); return true; }
  return false;
}

function readQuestionInput(panel) {
  const field = (name) => panel?.querySelector(`[data-question-inspector-field="${name}"]`)?.value ?? '';
  const objectiveIds = [...(panel?.querySelectorAll('[data-question-objective-option]:checked') ?? [])]
    .map((input) => input.value)
    .filter(Boolean);
  const sources = [...(panel?.querySelectorAll('[data-question-source-row]') ?? [])].map((row) => ({
    id: row.dataset.questionSourceRow,
    sourceType: row.querySelector('[data-question-source-field="sourceType"]')?.value ?? 'manual',
    sourceId: row.querySelector('[data-question-source-field="sourceId"]')?.value ?? '',
    quote: row.querySelector('[data-question-source-field="quote"]')?.value ?? '',
    status: row.querySelector('[data-question-source-field="status"]')?.value ?? 'active'
  }));
  return {
    questionType: field('questionType'),
    difficulty: field('difficulty') || null,
    stem: field('stem'),
    options: parseJsonField(field('options')),
    referenceAnswer: parseJsonField(field('referenceAnswer')),
    rubric: parseJsonField(field('rubric')),
    explanation: field('explanation'),
    learningObjectiveIds: objectiveIds,
    sources
  };
}

function parseJsonField(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
