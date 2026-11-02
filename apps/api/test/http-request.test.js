import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AppError } from '../src/errors/app-error.js';
import { parseBody } from '../src/http/request.ts';

function createRequest({ contentType = 'application/json', chunks = [] } = {}) {
  const request = new EventEmitter();
  request.headers = { 'content-type': contentType };
  request.destroy = () => {};

  queueMicrotask(() => {
    for (const chunk of chunks) {
      request.emit('data', Buffer.from(chunk));
    }
    request.emit('end');
  });

  return request;
}

export const httpRequestTests = [
  {
    name: 'parseBody 严格匹配 JSON MIME essence，保留参数、大小写与空正文',
    async run() {
      for (const contentType of [
        'text/plain; charset=application/json',
        'application/jsonp',
        'text/application/json',
        'application/json,text/plain'
      ]) {
        await assert.rejects(
          () => parseBody(createRequest({ contentType, chunks: ['{}'] })),
          error => error.statusCode === 415
        );
      }
      for (const contentType of [
        'application/json',
        'Application/JSON; charset=UTF-8',
        ' application/json ; charset=utf-8'
      ]) {
        assert.deepEqual(await parseBody(createRequest({ contentType, chunks: ['{}'] })), {});
      }
      assert.deepEqual(await parseBody(createRequest({ contentType: '', chunks: [] })), {});
    }
  },
  {
    name: 'parseBody preserves multilingual JSON at every byte boundary',
    async run() {
      const expected = { title: '中文😀e\u0301', rawMarkdown: '# 标题\n\n保存“正文”与 emoji 🚀' };
      const bytes = Buffer.from(JSON.stringify(expected));
      for (let split = 1; split < bytes.length; split += 1) {
        const result = await parseBody(createRequest({ chunks: [bytes.subarray(0, split), bytes.subarray(split)] }));
        assert.deepEqual(result, expected, `UTF-8 split at byte ${split}`);
      }
      assert.deepEqual(
        await parseBody(createRequest({ chunks: [...bytes].map(byte => Buffer.from([byte])) })),
        expected
      );
    }
  },
  {
    name: 'parseBody rejects JSON bodies over the configured size limit',
    async run() {
      await assert.rejects(
        () => parseBody(createRequest({ chunks: ['{"name":"too-large"}'] }), { limitBytes: 4 }),
        error => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 413);
          assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
          return true;
        }
      );
    }
  },
  {
    name: 'parseBody rejects non-JSON request bodies',
    async run() {
      await assert.rejects(
        () => parseBody(createRequest({ contentType: 'text/plain', chunks: ['plain text'] })),
        error => {
          assert.ok(error instanceof AppError);
          assert.equal(error.statusCode, 415);
          assert.equal(error.code, 'UNSUPPORTED_MEDIA_TYPE');
          return true;
        }
      );
    }
  }
];
