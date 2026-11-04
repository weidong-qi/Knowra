import assert from 'node:assert/strict';
import {
  findInsecureImageUrlsInDocument,
  findInsecureImageUrlsInText,
  introducesInsecureImageUrls
} from '../lib/editor/insecure-image-sources.js';

function createDoc(sources = []) {
  return {
    descendants(callback) {
      sources.forEach((src) => callback({ attrs: { src } }));
    }
  };
}

assert.deepEqual(
  findInsecureImageUrlsInText(
    '![one](http://example.com/one.png)\n<img src="http://example.com/two.png">'
  ),
  ['http://example.com/one.png', 'http://example.com/two.png']
);
assert.deepEqual(
  findInsecureImageUrlsInText('![safe](https://example.com/safe.png)'),
  []
);
assert.deepEqual(
  findInsecureImageUrlsInDocument(createDoc([
    'https://example.com/safe.png',
    'http://example.com/unsafe.png'
  ])),
  ['http://example.com/unsafe.png']
);
assert.deepEqual(
  introducesInsecureImageUrls(
    createDoc(['http://example.com/legacy.png']),
    createDoc(['http://example.com/legacy.png', 'http://example.com/legacy.png'])
  ),
  ['http://example.com/legacy.png']
);

console.log('ok - insecure HTTP image sources are detected before persistence');
