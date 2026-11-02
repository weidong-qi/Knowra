import fs from 'node:fs';
import { JSONParser } from '@streamparser/json';

// 同步存储工厂保持原接口；分块输入避免同时保留整个文件的 UTF-8/UTF-16 文本。
// paths 可只保留检查所需字段；被跳过的数据仍经过完整 JSON 语法检查。
/**
 * @param {import('node:fs').PathLike} filePath
 * @param {{paths?: string[], onValue?: JSONParser['onValue'], onToken?: JSONParser['onToken'], allowEmpty?: boolean, chunkSize?: number}} options
 */
export function readJsonFileSync(
  filePath,
  { paths = ['$'], onValue, onToken, allowEmpty = false, chunkSize = 64 * 1024 } = {}
) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new TypeError('JSON chunk size must be positive');
  const parser = new JSONParser({ paths, keepStack: false, stringBufferSize: 64 * 1024, numberBufferSize: 256 });
  let result,
    hasContent = false;
  parser.onValue =
    onValue ??
    (({ value }) => {
      result = value;
    });
  if (onToken) parser.onToken = onToken;
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(chunkSize);
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      const chunk = buffer.subarray(0, count);
      if (!hasContent) {
        const first = chunk.find(byte => ![9, 10, 13, 32].includes(byte));
        // 解析库接受 BOM；既有 JSON.parse 文件入口拒绝带 BOM/UTF-16/UTF-32 的文档。
        if ([0xef, 0xfe, 0xff, 0].includes(first)) throw new SyntaxError('JSON file must be UTF-8 without BOM');
        hasContent = first !== undefined;
      }
      parser.write(chunk);
    }
    if (!hasContent) {
      if (allowEmpty) return undefined;
      throw new SyntaxError('JSON file is empty');
    }
    if (!parser.isEnded) parser.end();
    return result;
  } finally {
    fs.closeSync(descriptor);
  }
}
