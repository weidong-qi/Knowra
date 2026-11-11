import assert from 'node:assert/strict';

export const phase31WorkspaceQueryTests = [
  {
    name: 'Phase3.1 workspace queries return stable paginated knowledge and training DTOs',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.ts');
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'phase31-query-note',
        spaceId: 'phase31-query-space',
        title: '导数笔记',
        rawMarkdown: '导数描述变化率'
      });
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'phase31-query-item',
        title: '导数',
        canonicalStatement: '导数描述变化率',
        sourceMode: 'manual'
      }).item;
      knowledge.knowledgeItemService.createEvidence({
        knowledgeItemId: item.id,
        sourceType: 'manual',
        noteId: note.id,
        quoteText: '导数描述变化率'
      });
      knowledge.knowledgeItemService.confirmItem(item.id);
      const objective = knowledge.learningObjectiveService.createCandidate({
        id: 'phase31-query-objective',
        knowledgeItemId: item.id,
        objective: '能够解释导数的几何意义',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });
      knowledge.learningObjectiveService.confirmObjective(objective.id);
      const question = knowledge.questionService.createQuestion({
        id: 'phase31-query-question',
        questionType: 'shortAnswer',
        stem: '请解释导数的几何意义。',
        referenceAnswer: '切线斜率。',
        learningObjectiveIds: [objective.id],
        sources: [{ sourceType: 'learningObjective', sourceId: objective.id, quote: objective.objective }]
      });

      const itemPage = await knowledge.workspaceQueryService.listKnowledgeItems({ limit: 10, query: '导数' });
      assert.equal(itemPage.items[0].id, item.id);
      assert.equal(itemPage.items[0].objectiveCount, 1);
      assert.equal(itemPage.items[0].confirmedObjectiveCount, 1);
      assert.equal(itemPage.items[0].questionCount, 1);
      assert.deepEqual(itemPage.items[0].noteIds, [note.id]);
      assert.equal(itemPage.pagination.hasMore, false);

      const objectivePage = await knowledge.workspaceQueryService.listLearningObjectives({ hasQuestions: 'true' });
      assert.deepEqual(
        objectivePage.items.map(entry => entry.id),
        [objective.id]
      );
      const questionPage = await knowledge.workspaceQueryService.listQuestions({ learningObjectiveId: objective.id });
      assert.equal(questionPage.items[0].id, question.id);
      assert.equal(questionPage.items[0].primaryObjective.id, objective.id);
      assert.equal(questionPage.items[0].sourceStatus, 'valid');
      assert.equal(questionPage.items[0].sources[0].quoteText, objective.objective);
    }
  },
  {
    name: 'Phase3.1 overview and review queue expose real coverage and stale-source work',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.ts');
      const knowledge = createKnowledgeModule();
      const item = knowledge.knowledgeItemService.createCandidate({
        id: 'phase31-review-item',
        title: '待审核知识',
        canonicalStatement: '需要人工确认的知识',
        sourceMode: 'manual'
      }).item;
      const objective = knowledge.learningObjectiveService.createCandidate({
        id: 'phase31-review-objective',
        knowledgeItemId: item.id,
        objective: '能够说明审核状态',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });
      knowledge.knowledgeItemService.confirmItem(item.id);
      knowledge.learningObjectiveService.confirmObjective(objective.id);
      const question = knowledge.questionService.createQuestion({
        id: 'phase31-review-question',
        stem: '审核状态是什么？',
        referenceAnswer: '候选、确认或归档。',
        learningObjectiveIds: [objective.id],
        sources: [{ sourceType: 'learningObjective', sourceId: objective.id }]
      });
      knowledge.questionService.markSourceStale('learningObjective', objective.id);

      const overview = await knowledge.workspaceQueryService.getKnowledgeOverview();
      assert.equal(overview.knowledgeItems.total, 1);
      assert.equal(overview.coverage.itemsWithoutQuestions, 0);
      const trainingOverview = await knowledge.workspaceQueryService.getTrainingOverview();
      assert.equal(trainingOverview.review.staleSources, 1);
      assert.equal(trainingOverview.questions.total, 1);
      const queue = await knowledge.workspaceQueryService.listReviewQueue({ limit: 50 });
      assert.ok(queue.items.some(entry => entry.kind === 'question' && entry.id === question.id));
      assert.ok(queue.items.some(entry => entry.kind === 'learningObjective' && entry.id === objective.id) === false);
      assert.ok(queue.items.every(entry => entry.resourceId));
    }
  }
];
