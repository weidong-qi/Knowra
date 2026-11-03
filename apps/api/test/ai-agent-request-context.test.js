import assert from 'node:assert/strict';
import {
  authorizedHistory,
  authorizedQuestion,
  plainHistory,
  plainMessages
} from '../src/modules/ai/agent-request-context.ts';
import { hashRecord } from '../src/modules/ai/record-contract.js';
import { PROPOSAL_GUIDANCE } from '../src/modules/ai/proposal-progress.ts';
import { ASSISTANT_GUIDANCE } from '../src/modules/ai/assistant-tools.ts';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const row = (content, extra = {}) => ({
  role: 'user',
  content,
  sourceRefs: [],
  sourceFree: true,
  provenanceManifestId: null,
  ...extra
});
const offline = '\n真实联网尚未配置，核实时不能假称已联网。';
const online = '\n联网工具仅返回合成验收资料。';
const question = extra => ({
  userContent: '问题',
  round: 0,
  finalOnly: false,
  proposalRequested: false,
  draftContext: '',
  toolFeedback: '',
  progress: '',
  proposalNudge: '',
  externalContext: '',
  webSearchEnabled: false,
  searchFallback: false,
  searchTruncated: false,
  plainContext: '',
  ...extra
});

export const aiAgentRequestContextTests = [
  {
    name: '请求上下文：普通历史先过滤再取末八条，冻结输入且隔离仅含目录标题的授权回答',
    run() {
      const prior = freeze([
        ...Array.from({ length: 10 }, (_, i) => row(`普通${i}`)),
        row('授权目录标题', { role: 'assistant', provenanceManifestId: 'manifest-catalog' }),
        row('有来源', { sourceRefs: [{ noteId: 'private' }] }),
        row('非自由来源', { sourceFree: false }),
        row('长'.repeat(4001))
      ]);
      const before = JSON.stringify(prior);
      assert.deepEqual(
        plainHistory(prior),
        Array.from({ length: 8 }, (_, i) => ({ role: 'user', content: `普通${i + 2}` }))
      );
      assert.equal(JSON.stringify(prior), before);
      assert.equal(plainHistory(freeze([row('长'.repeat(4000))]))[0].content.length, 4000);
    }
  },
  {
    name: '请求上下文：授权历史先取末八条再过滤，保留来源字段和准确 provenanceHash',
    run() {
      const sourceRefs = [{ noteId: 'n', start: 0, end: 2 }];
      const kept = row('授权回答', {
        role: 'assistant',
        sourceFree: false,
        sourceRefs,
        provenanceManifestId: 'manifest-1'
      });
      const atLimit = row('界'.repeat(12000));
      const prior = freeze([
        row('窗口外'),
        row('普通助手', { role: 'assistant' }),
        kept,
        atLimit,
        row('超'.repeat(12001)),
        row('危险助手', { role: 'assistant', sourceFree: false }),
        row('带来源助手', { role: 'assistant', sourceRefs }),
        row('新提问'),
        row('普通尾部', { role: 'assistant' })
      ]);
      const result = authorizedHistory(prior);
      assert.deepEqual(
        result.entries,
        [kept, atLimit, prior[7]].map(item => ({ ...item, provenanceHash: hashRecord(item) }))
      );
      assert.equal(result.plainContext, '助手：普通助手\n助手：普通尾部');
      assert.equal(Object.hasOwn(kept, 'provenanceHash'), false);
    }
  },
  {
    name: '请求上下文：普通助手摘录先逐条500再末四条并整体1600 UTF-16裁剪',
    run() {
      const prior = freeze(Array.from({ length: 6 }, (_, i) => row(`${i}${'😀'.repeat(300)}`, { role: 'assistant' })));
      const expected = prior
        .slice(-4)
        .map(item => `助手：${item.content.slice(0, 500)}`)
        .join('\n')
        .slice(0, 1600);
      assert.deepEqual(authorizedHistory(prior), { entries: [], plainContext: expected });
      assert.equal(expected.length, 1600);
      assert.equal(
        authorizedHistory(freeze([row('超'.repeat(12001), { role: 'assistant' })])).plainContext,
        `助手：${'超'.repeat(500)}`
      );
    }
  },
  {
    name: '请求上下文：授权问题逐字保持提示顺序、提炼指引与最终轮规则',
    run() {
      const parts = {
        draftContext: '草稿',
        toolFeedback: '反馈',
        progress: '进度',
        proposalNudge: '提醒',
        externalContext: '外部',
        plainContext: '普通',
        searchFallback: true,
        searchTruncated: true,
        proposalRequested: true
      };
      const warnings =
        '\n候选索引未提供可用结果，已使用关键词检索；关键词未命中不等于授权资料没有答案。\n检索受到本次处理上限限制，不得声称已检查完整授权范围。';
      const guidance =
        '\n工具结果已写入当前 sources 或 catalog。若已足够，请直接回答；只有缺少关键来源时才继续搜索或阅读。';
      const final = '\n工具结果已写入当前 sources 或 catalog。请直接依据这些来源作答；不足之处明确说明。';
      for (const round of [0, 1])
        for (const finalOnly of [false, true])
          for (const webSearchEnabled of [false, true]) {
            const input = freeze(question({ ...parts, round, finalOnly, webSearchEnabled }));
            assert.equal(
              authorizedQuestion(input),
              `先前普通聊天：普通\n问题${round ? (finalOnly ? final : guidance) : ''}${finalOnly ? '' : PROPOSAL_GUIDANCE}草稿反馈进度提醒外部${webSearchEnabled ? online : offline}${warnings}`
            );
          }
    }
  },
  {
    name: '请求上下文：4000上限与普通上下文7/8字符余量边界保持不变',
    run() {
      for (const room of [0, 7, 8, 9]) {
        const userContent = '问'.repeat(4000 - offline.length - room);
        const expectedContext = room >= 8 ? '先前普通聊天：😀补充\n'.slice(0, room) : '';
        assert.equal(
          authorizedQuestion(freeze(question({ userContent, plainContext: '😀补充' }))),
          `${expectedContext}${userContent}${offline}`
        );
      }
      assert.equal(authorizedQuestion(question({ userContent: '问'.repeat(4000 - offline.length) })).length, 4000);
      assert.throws(() => authorizedQuestion(question({ userContent: '问'.repeat(4001 - offline.length) })), {
        code: 'AI_INPUT_TOO_LARGE',
        message: '提问与必要的检索说明超过上限。'
      });
    }
  },
  {
    name: '请求上下文：必要覆盖提示占用长度，空普通上下文不引入前缀',
    run() {
      const input = question({ draftContext: '草'.repeat(3977), userContent: '' });
      assert.equal(authorizedQuestion(input), input.draftContext + offline);
      assert.throws(() => authorizedQuestion(question({ userContent: '', toolFeedback: '反'.repeat(4000) })), {
        code: 'AI_INPUT_TOO_LARGE'
      });
      assert.equal(authorizedQuestion(question({ plainContext: '' })), '问题' + offline);
    }
  },
  {
    name: '请求上下文：无授权消息仅保留安全历史与原顺序，写入意图/联网声明逐字保持',
    run() {
      for (const webSearchEnabled of [false, true])
        for (const writeIntent of [null, { toolName: 'notes_create' }]) {
          const prior = freeze([
            row('安全'),
            row('私有标题', { role: 'assistant', provenanceManifestId: 'catalog-manifest' })
          ]);
          const messages = plainMessages(
            freeze({
              prior,
              userContent: '提问',
              draftContext: '草稿',
              toolFeedback: '反馈',
              externalContext: '外部',
              webSearchEnabled,
              writeIntent
            })
          );
          assert.deepEqual(messages, [
            {
              role: 'system',
              content: `${ASSISTANT_GUIDANCE} 此会话没有笔记读取授权；不得声称读过用户资料或编造笔记引用。${webSearchEnabled ? '联网工具仅返回合成验收资料。' : '真实联网尚未配置；需要最新信息或核实时明确说明不可用，不能假称已联网。'}${writeIntent ? '用户已明确请求生成笔记计划，只调用所开放的写入计划工具；不得宣称已保存。' : ''}`
            },
            { role: 'user', content: '安全' },
            { role: 'user', content: '提问草稿反馈外部' }
          ]);
        }
    }
  }
];
