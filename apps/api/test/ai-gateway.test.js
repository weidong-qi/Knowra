import assert from 'node:assert/strict';
import { createAiGateway, AiGatewayError } from '../src/modules/ai/gateway.ts';
import { createMockAiAdapter } from '../src/modules/ai/infrastructure/providers/mock-adapter.ts';
import { createDeepSeekAdapter } from '../src/modules/ai/infrastructure/providers/deepseek-adapter.ts';
import { deepSeekPayload } from '../src/modules/ai/outbound-payload.ts';
import { runCapabilityProbe } from '../src/modules/ai/capability-probe.ts';

const messages = [{ role: 'user', content: '请总结这段合成文字。' }];
const completion = (content, finish_reason = 'stop', extra = {}) => ({
  id: 'reply-1',
  model: 'deepseek-flash',
  choices: [{ finish_reason, message: { content, ...(extra.toolCalls ? { tool_calls: extra.toolCalls } : {}) } }],
  ...(extra.usage ? { usage: extra.usage } : {})
});
const tool = {
  name: 'notes_read',
  description: '读取获准笔记',
  parameters: { type: 'object', properties: { noteIds: { type: 'array' } } }
};

export const aiGatewayTests = [
  {
    name: 'AI Gateway：JSON 解析容忍围栏与说明文字，带工具时不强制 json_object 且纯文本回答按无引用处理',
    async run() {
      const jsonMessages = [{ role: 'system', content: '返回 JSON' }, ...messages];
      const adapter = createMockAiAdapter({
        steps: [
          { response: completion('```json\n{"answer":"围栏","citations":[]}\n```') },
          { response: completion('结果如下：{"answer":"夹带说明","citations":[]} 以上。') },
          { response: completion('我直接用文字回答。') },
          { response: completion('我直接用文字回答。') }
        ]
      });
      const gateway = createAiGateway({ adapter });
      assert.equal((await gateway.complete({ messages: jsonMessages, format: 'json' })).json.answer, '围栏');
      assert.equal((await gateway.complete({ messages: jsonMessages, format: 'json' })).json.answer, '夹带说明');
      assert.deepEqual((await gateway.complete({ messages: jsonMessages, format: 'json', tools: [tool] })).json, {
        answer: '我直接用文字回答。',
        citations: []
      });
      await assert.rejects(gateway.complete({ messages: jsonMessages, format: 'json' }), { code: 'AI_JSON_INVALID' });
      const request = { messages: jsonMessages, format: 'json', maxTokens: 64, tools: [], modelId: 'm' };
      assert.deepEqual(deepSeekPayload(request).response_format, { type: 'json_object' });
      assert.equal(deepSeekPayload({ ...request, tools: [tool] }).response_format, undefined);
      assert.deepEqual(deepSeekPayload(request).thinking, { type: 'disabled' });
    }
  },
  {
    name: 'AI Gateway：Mock 文本、JSON、流式、拒答与截断状态不混淆',
    async run() {
      const adapter = createMockAiAdapter({
        steps: [
          { response: completion('合成结果', 'stop', { usage: { prompt_tokens: 12, completion_tokens: 4 } }) },
          { response: completion('{"ok":true}') },
          { deltas: ['合', '成'], response: completion('合成') },
          { response: completion('', 'content_filter') },
          { response: completion('{"unfinished":', 'length') }
        ]
      });
      const gateway = createAiGateway({ adapter });
      assert.equal((await gateway.complete({ messages })).usage.unknown, false);
      assert.deepEqual(
        (await gateway.complete({ messages: [{ role: 'system', content: '返回 JSON' }, ...messages], format: 'json' }))
          .json,
        { ok: true }
      );
      const events = [];
      for await (const event of gateway.stream({ messages })) events.push(event);
      assert.deepEqual(
        events.map(event => event.type),
        ['delta', 'delta', 'result']
      );
      assert.equal(events[2].result.content, '合成');
      assert.equal(events[2].result.usage.unknown, true);
      assert.equal((await gateway.complete({ messages })).refused, true);
      assert.equal((await gateway.complete({ messages })).truncated, true);
      assert.equal(adapter.calls.length, 5);
    }
  },
  {
    name: 'AI Gateway：无权工具、畸形参数和不完整流阻断',
    async run() {
      const adapter = createMockAiAdapter({
        steps: [
          {
            response: completion(null, 'tool_calls', {
              toolCalls: [{ id: 'c1', type: 'function', function: { name: 'notes_create', arguments: '{}' } }]
            })
          },
          {
            response: completion(null, 'tool_calls', {
              toolCalls: [{ id: 'c2', type: 'function', function: { name: 'notes_read', arguments: '{bad' } }]
            })
          },
          { deltas: ['部分'] }
        ]
      });
      const gateway = createAiGateway({ adapter });
      await assert.rejects(gateway.complete({ messages, tools: [tool] }), error => error.code === 'AI_TOOL_INVALID');
      await assert.rejects(
        gateway.complete({ messages, tools: [tool] }),
        error => error.code === 'AI_TOOL_ARGUMENTS_INVALID'
      );
      await assert.rejects(
        async () => {
          for await (const _event of gateway.stream({ messages })) {
            /* 消耗流。 */
          }
        },
        error => error.code === 'AI_STREAM_INCOMPLETE'
      );
    }
  },
  {
    name: 'DeepSeek adapter：预算授权先于凭据读取，固定端点且请求不携带额外字段',
    async run() {
      const calls = [];
      let credentialsRead = 0;
      const adapter = createDeepSeekAdapter({
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          return new Response(
            JSON.stringify(completion('合成结果', 'stop', { usage: { prompt_tokens: 2, completion_tokens: 3 } })),
            { status: 200 }
          );
        }
      });
      let authorized = false;
      const gateway = createAiGateway({
        adapter,
        authorizePaidCall: async () => authorized,
        resolveCredential: async reference => {
          credentialsRead += 1;
          assert.equal(reference, 'credential-1');
          return { apiKey: 'synthetic-secret', modelId: 'deepseek-flash' };
        }
      });
      const request = { messages, credentialRef: 'credential-1', modelId: 'deepseek-flash' };
      await assert.rejects(gateway.complete(request), error => error.code === 'AI_BUDGET_NOT_AUTHORIZED');
      assert.equal(credentialsRead, 0);
      authorized = true;
      const result = await gateway.complete(request);
      assert.equal(result.content, '合成结果');
      assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
      assert.equal(calls[0].options.redirect, 'error');
      assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-secret');
      assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)).sort(), [
        'max_tokens',
        'messages',
        'model',
        'stream',
        'thinking'
      ]);
      assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
      assert.equal((await gateway.capabilities()).verified, false);
    }
  },
  {
    name: 'DeepSeek adapter：SSE 增量、工具片段、用量与 DONE 完整性',
    async run() {
      const frames = [
        ': keep-alive\n\n',
        'data: {"id":"s1","model":"deepseek-flash","choices":[{"delta":{"content":"中"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"文"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n'
      ];
      const fetchImpl = async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
              controller.close();
            }
          }),
          { status: 200 }
        );
      const gateway = createAiGateway({
        adapter: createDeepSeekAdapter({ fetchImpl }),
        authorizePaidCall: async () => true,
        resolveCredential: async () => ({ apiKey: 'synthetic-secret', modelId: 'deepseek-flash' })
      });
      const events = [];
      for await (const event of gateway.stream({ messages, credentialRef: 'credential-1' })) events.push(event);
      assert.deepEqual(
        events.map(event => event.type),
        ['delta', 'delta', 'result']
      );
      assert.equal(events[2].result.content, '中文');
      assert.equal(events[2].result.usage.outputTokens, 2);
      const toolFrames = [
        {
          id: 's2',
          model: 'deepseek-flash',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'notes_read', arguments: '{"noteIds":' }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: '["synthetic-note"]}' } }] },
              finish_reason: 'tool_calls'
            }
          ]
        }
      ];
      const toolFetch = async () =>
        new Response(`${toolFrames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`);
      const toolGateway = createAiGateway({
        adapter: createDeepSeekAdapter({ fetchImpl: toolFetch }),
        authorizePaidCall: async () => true,
        resolveCredential: async () => ({ apiKey: 'synthetic-secret', modelId: 'deepseek-flash' })
      });
      const toolEvents = [];
      for await (const event of toolGateway.stream({ messages, tools: [tool], credentialRef: 'credential-1' }))
        toolEvents.push(event);
      assert.deepEqual(toolEvents.at(-1).result.toolCalls[0].arguments, { noteIds: ['synthetic-note'] });
      const incomplete = createAiGateway({
        adapter: createDeepSeekAdapter({
          fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":"残"},"finish_reason":null}]}\n\n')
        }),
        authorizePaidCall: async () => true,
        resolveCredential: async () => ({ apiKey: 'synthetic-secret', modelId: 'deepseek-flash' })
      });
      await assert.rejects(
        async () => {
          for await (const _event of incomplete.stream({ messages, credentialRef: 'credential-1' })) {
            /* 消耗流。 */
          }
        },
        error => error.code === 'AI_STREAM_INCOMPLETE'
      );
    }
  },
  {
    name: 'DeepSeek adapter：错误归一化不回显供应商正文、密钥或请求',
    async run() {
      const adapter = createDeepSeekAdapter({
        fetchImpl: async () => new Response('synthetic-secret', { status: 429 })
      });
      const gateway = createAiGateway({
        adapter,
        authorizePaidCall: async () => true,
        resolveCredential: async () => ({ apiKey: 'synthetic-secret', modelId: 'deepseek-flash' })
      });
      await assert.rejects(
        gateway.complete({ messages, credentialRef: 'credential-1' }),
        error =>
          error instanceof AiGatewayError &&
          error.code === 'AI_RATE_LIMITED' &&
          error.retryable &&
          error.httpStatus === 429 &&
          !error.message.includes('synthetic-secret')
      );
    }
  },
  {
    name: '能力探测：合成输入逐项记录状态，未预留费用时真实 adapter 立即阻断',
    async run() {
      const mock = createAiGateway({
        adapter: createMockAiAdapter({
          steps: [
            { response: completion('合成测试完成') },
            { response: completion('{"synthetic":true}') },
            {
              response: completion(null, 'tool_calls', {
                toolCalls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'notes_read', arguments: '{"noteIds":["synthetic-note"]}' }
                  }
                ]
              })
            },
            { response: completion('截', 'length') },
            { response: completion('', 'content_filter') },
            { deltas: ['流式'], response: completion('流式合成测试') }
          ]
        })
      });
      const report = await runCapabilityProbe({ gateway: mock, modelId: 'deepseek-flash' });
      assert.deepEqual(
        Object.values(report.scenarios).map(item => item.status),
        Array(7).fill('observed')
      );
      assert.equal(JSON.stringify(report).includes('合成测试完成'), false);
      const real = createAiGateway({
        adapter: createDeepSeekAdapter({
          fetchImpl: () => {
            throw new Error('network must not be used');
          }
        }),
        resolveCredential: () => {
          throw new Error('credential must not be read');
        }
      });
      const blocked = await runCapabilityProbe({ gateway: real, credentialRef: 'credential-1' });
      assert.equal(blocked.scenarios.text.status, 'blocked');
      assert.equal(Object.keys(blocked.scenarios).length, 1);
    }
  }
];
