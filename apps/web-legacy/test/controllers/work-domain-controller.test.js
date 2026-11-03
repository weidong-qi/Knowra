import assert from 'node:assert/strict';
import { createWorkDomainController } from '../../src/controllers/work-domain-controller.js';

function createHarness() {
  const state = {
    statusMessage: '已切换到：Transformer',
    navigation: {
      activeWorkDomain: 'materials',
      activeDomainView: 'overview'
    },
    view: { screen: 'editor' },
    knowledgeWorkspace: { selection: { kind: 'knowledgeItem', id: 'item-1' } },
    trainingWorkspace: { selection: { kind: 'question', id: 'question-1' } }
  };
  const calls = [];
  const controller = createWorkDomainController({
    state,
    elements: { workDomainContent: { innerHTML: '' } },
    renderAll: () => calls.push('renderAll'),
    knowledgeWorkspaceController: { load: async () => true, refresh: async () => true },
    trainingWorkspaceController: { load: async () => true, refresh: async () => true }
  });

  return { controller, state, calls };
}

const { controller, state, calls } = createHarness();

assert.equal(controller.selectWorkDomain('knowledge'), true);
assert.equal(state.statusMessage, '当前工作域：知识库');
assert.equal(state.navigation.activeWorkDomain, 'knowledge');
assert.equal(calls.pop(), 'renderAll');

assert.equal(controller.selectWorkDomain('materials'), true);
assert.equal(state.statusMessage, '当前工作域：资料库');
assert.equal(state.view.screen, 'index');
assert.equal(calls.pop(), 'renderAll');

controller.openTraining('questions');
assert.equal(state.statusMessage, '当前工作域：训练场');
assert.equal(state.navigation.activeWorkDomain, 'training');
assert.equal(calls.pop(), 'renderAll');

controller.openKnowledge('items');
assert.equal(state.statusMessage, '当前工作域：知识库');
assert.equal(state.navigation.activeWorkDomain, 'knowledge');
assert.equal(calls.pop(), 'renderAll');

await controller.openHome();
assert.equal(state.statusMessage, '当前工作台：主页概览');
assert.equal(state.navigation.activeWorkDomain, 'materials');
assert.equal(state.view.screen, 'home');
assert.equal(calls.pop(), 'renderAll');

console.log('ok - work domain transitions refresh the feature status context');
