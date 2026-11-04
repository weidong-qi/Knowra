import assert from 'node:assert/strict';

export const httpResponseTests = [
  {
    name: 'sendBinary only renders passive images inline and adds browser hardening headers',
    async run() {
      const { sendBinary } = await import('../src/http/response.ts');
      const imageResponse = createResponseRecorder();
      const svgResponse = createResponseRecorder();

      sendBinary(imageResponse, 200, Buffer.from('png'), 'image/png', '示例.png');
      sendBinary(svgResponse, 200, Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml', 'unsafe.svg');

      assert.equal(imageResponse.statusCode, 200);
      assert.equal(imageResponse.headers['Content-Type'], 'image/png');
      assert.match(imageResponse.headers['Content-Disposition'], /^inline;/);
      assert.equal(imageResponse.headers['X-Content-Type-Options'], 'nosniff');
      assert.equal(svgResponse.headers['Content-Type'], 'application/octet-stream');
      assert.match(svgResponse.headers['Content-Disposition'], /^attachment;/);
      assert.equal(svgResponse.headers['Content-Security-Policy'], 'sandbox');
    }
  }
];

function createResponseRecorder() {
  return {
    statusCode: null,
    headers: null,
    content: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(content) {
      this.content = content;
    }
  };
}
