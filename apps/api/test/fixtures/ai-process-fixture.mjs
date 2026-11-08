process.on('message', message => {
  if (message?.request?.messages) {
    process.send?.({
      type: 'result',
      id: message.id,
      result: {
        choices: [{ finish_reason: 'stop', message: { content: '合成译文' } }],
        usage: { prompt_tokens: 40, completion_tokens: 20 }
      }
    });
    return;
  }
  if (message?.request?.mode === 'crash') process.exit(27);
  if (message?.request?.mode === 'hang') {
    process.send?.({ type: 'fixture-ready', mode: 'hang' });
    return;
  }
  if (message?.request?.mode === 'spin') {
    while (true) {}
  }
  if (message?.request?.mode === 'limit') {
    process.send?.({ type: 'resource', rssBytes: 999_999_999, cpuMs: 0 });
    return;
  }
  process.send?.({ type: 'result', id: message.id, result: { ok: true } });
});
