import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { fail } from '../modules/task-workspaces/contract.js';

export const TASK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const TASK_IMAGE_MAX_PIXELS = 16_000_000;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const formats = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

function validateContainer(bytes, mime) {
  if (mime === 'image/png') {
    if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail();
    let offset = 8,
      ended = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) fail();
      const length = bytes.readUInt32BE(offset),
        end = offset + 12 + length;
      if (end > bytes.length) fail();
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset === 8 && (type !== 'IHDR' || length !== 13)) fail();
      if (type === 'acTL' || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail();
      if (type === 'IEND') {
        if (length || end !== bytes.length) fail();
        ended = true;
      }
      offset = end;
    }
    if (!ended) fail();
  } else if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) fail();
  } else if (mime === 'image/webp') {
    if (
      bytes.length < 20 ||
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP' ||
      bytes.readUInt32LE(4) + 8 !== bytes.length
    )
      fail();
  }
}

/** 本地解码原始字节，不读取URL、SVG、文件引用或外部解码命令。 */
export async function verifyTaskImage(bytes, declaredMime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) fail();
  if (bytes.length > TASK_IMAGE_MAX_BYTES) fail('LIMIT');
  if (!Object.values(formats).includes(declaredMime)) fail();
  validateContainer(bytes, declaredMime);
  try {
    /** @type {import('sharp').SharpOptions} */
    const options = { limitInputPixels: TASK_IMAGE_MAX_PIXELS, failOn: 'warning', sequentialRead: true };
    const metadata = await sharp(bytes, options).metadata();
    const { width, height, format, pages = 1 } = metadata;
    if (
      formats[format] !== declaredMime ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > TASK_IMAGE_MAX_PIXELS ||
      pages !== 1
    )
      fail();
    // metadata alone does not detect truncated/corrupt compressed pixel streams.
    const decoded = await sharp(bytes, options).raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== width || decoded.info.height !== height) fail();
    return { mimeType: declaredMime, width, height, size: bytes.length, sha256: digest(bytes) };
  } catch (error) {
    if (error.code?.startsWith('TASK_WORKSPACE_')) throw error;
    fail();
  }
}
