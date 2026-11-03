import { describe, expect, it } from 'vitest';
import { decide, undoDecision, projectSession, type DemoSession } from './incrementalConfirmation';
import { INCREMENTAL_CONFIRMATION_FIXTURE as fixture } from './incrementalConfirmation.fixture';

describe('增量确认纯内存模型', () => {
  it('确认之前没有新增；复用概念只增加新条目，原文、正文和旧 Concept 集合不变', () => {
    const before = structuredClone(fixture);
    expect(projectSession(fixture, {})).toEqual({ concepts: [], items: [] });
    const session = decide(fixture, {}, 'reuse', { kind: 'existing', conceptId: 'backprop' });
    const result = projectSession(fixture, session);
    expect(result.concepts).toEqual([]);
    expect(result.items).toEqual([{ id: 'demo-item:reuse', title: fixture.proposals[0].title, statement: fixture.proposals[0].statement, conceptIds: ['backprop'], source: fixture.proposals[0].source }]);
    expect(fixture).toEqual(before);
    expect(projectSession(fixture, undoDecision(session, 'reuse'))).toEqual({ concepts: [], items: [] });
  });
  it('不同语义可另建，证据不足可待定；全部撤销后恢复初态', () => {
    const before = structuredClone(fixture);
    let session: DemoSession = decide(fixture, {}, 'distinct', { kind: 'new', name: ' x.grad ', sense: ' PyTorch 梯度属性 ' });
    session = decide(fixture, session, 'unclear', { kind: 'defer' });
    expect(projectSession(fixture, session)).toMatchObject({ concepts: [{ id: 'demo-concept:distinct', name: 'x.grad', sense: 'PyTorch 梯度属性' }], items: [{ conceptIds: ['demo-concept:distinct'] }] });
    expect(session.unclear).toEqual({ kind: 'defer' });
    session = undoDecision(undoDecision(session, 'distinct'), 'unclear');
    expect(session).toEqual({});
    expect(fixture).toEqual(before);
  });
  it('重复点击不会重复新增或替换决定；不接受不存在的候选、无效表单或其他提议的目标', () => {
    const session = decide(fixture, {}, 'reuse', { kind: 'existing', conceptId: 'backprop' });
    expect(decide(fixture, session, 'reuse', { kind: 'existing', conceptId: 'backprop' })).toBe(session);
    expect(decide(fixture, session, 'reuse', { kind: 'defer' })).toBe(session);
    expect(decide(fixture, {}, 'missing', { kind: 'defer' })).toEqual({});
    for (const conceptId of ['missing', 'gradient']) expect(decide(fixture, {}, 'reuse', { kind: 'existing', conceptId })).toEqual({});
    for (const [name, sense] of [[' ', '说明'], ['名字', ' '], ['名'.repeat(81), '说明'], ['名字', '说'.repeat(241)]]) {
      expect(decide(fixture, {}, 'distinct', { kind: 'new', name, sense })).toEqual({});
    }
  });
});
