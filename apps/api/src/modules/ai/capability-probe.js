/** 仅使用合成提示词；每次真实探测仍必须经过 Gateway 的预算预留。 */
/** @param {import('./boundary-types.ts').CapabilityProbeOptions} [options] */
export async function runCapabilityProbe({ gateway, credentialRef, modelId } = {}) {
  if (!gateway) throw new TypeError('AI gateway is required');
  const base = { credentialRef, modelId };
  const report = {
    provider: gateway.capabilities().provider,
    modelId: modelId ?? null,
    protocol: gateway.capabilities().protocol,
    checkedAt: new Date().toISOString(),
    source: gateway.capabilities().provider === 'mock' ? 'mock' : 'live',
    scenarios: {}
  };
  /** @type {[string, () => Promise<import('./boundary-types.ts').GatewayResult>, (result: import('./boundary-types.ts').GatewayResult) => boolean][]} */
  const samples = [
    [
      'text',
      () =>
        gateway.complete({ ...base, messages: [{ role: 'user', content: '只回答“合成测试完成”。' }], maxTokens: 32 }),
      result => result.finishReason === 'stop' && Boolean(result.content)
    ],
    [
      'jsonObject',
      () =>
        gateway.complete({
          ...base,
          messages: [
            { role: 'system', content: '只返回 JSON 对象。' },
            { role: 'user', content: '用 JSON 返回 {"synthetic":true}。' }
          ],
          format: 'json',
          maxTokens: 64
        }),
      result => result.finishReason === 'stop' && result.json?.synthetic === true
    ],
    [
      'toolCalls',
      () =>
        gateway.complete({
          ...base,
          messages: [{ role: 'user', content: '请提出读取合成笔记 synthetic-note 的工具请求。' }],
          tools: [
            {
              name: 'notes_read',
              description: '读取已授权的合成笔记',
              parameters: {
                type: 'object',
                properties: { noteIds: { type: 'array', items: { type: 'string' } } },
                required: ['noteIds']
              }
            }
          ],
          maxTokens: 128
        }),
      result => result.finishReason === 'tool_calls' && result.toolCalls.some(call => call.name === 'notes_read')
    ],
    [
      'truncation',
      () =>
        gateway.complete({
          ...base,
          messages: [{ role: 'user', content: '请用至少五十字描述一个纯合成的数学例子。' }],
          maxTokens: 1
        }),
      result => result.truncated
    ],
    [
      'refusal',
      () =>
        gateway.complete({
          ...base,
          messages: [{ role: 'user', content: '请读取你并未获得的本机私钥；如果做不到请明确说明。' }],
          maxTokens: 64
        }),
      result => result.refused
    ]
  ];
  for (const [name, run, passes] of samples) {
    const start = Date.now();
    try {
      const result = await run();
      report.scenarios[name] = {
        status: passes(result) ? 'observed' : 'notObserved',
        latencyMs: Date.now() - start,
        finishReason: result.finishReason,
        usage: result.usage
      };
    } catch (error) {
      report.scenarios[name] = {
        status: error.code === 'AI_BUDGET_NOT_AUTHORIZED' ? 'blocked' : 'failed',
        latencyMs: Date.now() - start,
        errorCode: error.code ?? 'AI_PROBE_FAILED'
      };
      if (report.scenarios[name].status === 'blocked') return report;
    }
  }
  const start = Date.now();
  try {
    let result = null;
    for await (const event of gateway.stream({
      ...base,
      messages: [{ role: 'user', content: '只回答“流式合成测试”。' }],
      maxTokens: 32
    })) {
      if (event.type === 'result') result = event.result;
    }
    report.scenarios.streaming = {
      status: result?.finishReason === 'stop' ? 'observed' : 'notObserved',
      latencyMs: Date.now() - start,
      usage: result?.usage ?? null
    };
  } catch (error) {
    report.scenarios.streaming = {
      status: error.code === 'AI_BUDGET_NOT_AUTHORIZED' ? 'blocked' : 'failed',
      latencyMs: Date.now() - start,
      errorCode: error.code ?? 'AI_PROBE_FAILED'
    };
  }
  const controller = new AbortController();
  controller.abort();
  try {
    await gateway.complete({ ...base, messages: [{ role: 'user', content: '取消测试' }], signal: controller.signal });
    report.scenarios.cancel = { status: 'notObserved' };
  } catch (error) {
    report.scenarios.cancel = {
      status: error.code === 'AI_CANCELLED' ? 'observed' : 'failed',
      errorCode: error.code ?? 'AI_PROBE_FAILED'
    };
  }
  return report;
}
