import type { ConfirmationFixture } from './incrementalConfirmation';

/** 完全合成，非用户笔记、非模型输出。每项来源文字只用于交互验收。 */
export const INCREMENTAL_CONFIRMATION_FIXTURE: ConfirmationFixture = {
  concepts: [
    { id: 'backprop', name: '反向传播', sense: 'backpropagation：沿计算图反向计算导数的方法' },
    { id: 'gradient', name: '数学梯度', sense: '多元函数各偏导数组成的向量' }
  ],
  items: [
    { id: 'old-backprop', title: '反向传播的基本方法', statement: '反向传播使用链式法则计算导数。', conceptIds: ['backprop'] },
    { id: 'old-gradient', title: '梯度的定义', statement: '梯度由各变量的偏导数组成。', conceptIds: ['gradient'] }
  ],
  proposals: [
    { id: 'reuse', title: '反向传播的新应用例子', statement: '在合成的两层网络练习中，用反向传播求损失对参数的导数。',
      source: { note: '合成笔记 A', quote: '这次两层网络练习，用 backpropagation 求损失对参数的导数。' },
      candidateId: 'backprop', suggestedName: '网络中的反向传播', suggestedSense: '两层网络中的导数计算' },
    { id: 'distinct', title: 'x.grad 的累积与清零', statement: '在这个 PyTorch 练习中，x.grad 保存累积的梯度值，下一次计算前需要按练习要求清零。',
      source: { note: '合成笔记 B', quote: 'PyTorch 练习：x.grad 保存累积的梯度值，下一轮前按要求清零。' },
      candidateId: 'gradient', suggestedName: 'x.grad 的使用', suggestedSense: 'PyTorch 张量的梯度存储与清零操作',
      opinion: '词面相关不代表语义身份相同；这是演示提示，不是原文。' },
    { id: 'unclear', title: '检查 grad', statement: '运行后检查 grad，具体含义还不清楚。',
      source: { note: '合成笔记 C', quote: '运行后检查 grad。' },
      candidateId: 'gradient', suggestedName: '', suggestedSense: '',
      opinion: '上下文不足，可以暂不决定；不应据此自动创建或归入概念。' }
  ]
};
