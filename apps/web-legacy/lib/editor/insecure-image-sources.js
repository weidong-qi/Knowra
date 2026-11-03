const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(\s*<?(http:\/\/[^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi;
const HTML_IMAGE_PATTERN = /<img\b[^>]*\bsrc\s*=\s*(?:"(http:\/\/[^"]+)"|'(http:\/\/[^']+)'|(http:\/\/[^\s>]+))/gi;

export function findInsecureImageUrlsInText(value) {
  const source = typeof value === 'string' ? value : '';
  const urls = [];

  collectMatches(source, MARKDOWN_IMAGE_PATTERN, (match) => match[1], urls);
  collectMatches(source, HTML_IMAGE_PATTERN, (match) => match[1] ?? match[2] ?? match[3], urls);

  return [...new Set(urls)];
}

export function findInsecureImageUrlsInDocument(doc) {
  const urls = [];
  doc?.descendants?.((node) => {
    const src = typeof node?.attrs?.src === 'string' ? node.attrs.src.trim() : '';
    if (src.toLowerCase().startsWith('http://')) {
      urls.push(src);
    }
  });
  return [...new Set(urls)];
}

export function introducesInsecureImageUrls(currentDoc, nextDoc) {
  const currentCounts = countInsecureImageUrlsInDocument(currentDoc);
  const nextCounts = countInsecureImageUrlsInDocument(nextDoc);
  return [...nextCounts.entries()]
    .filter(([url, count]) => count > (currentCounts.get(url) ?? 0))
    .map(([url]) => url);
}

function collectMatches(source, pattern, selectValue, target) {
  pattern.lastIndex = 0;
  let match = pattern.exec(source);
  while (match) {
    const value = selectValue(match);
    if (value) {
      target.push(value);
    }
    match = pattern.exec(source);
  }
}

function countInsecureImageUrlsInDocument(doc) {
  const counts = new Map();
  doc?.descendants?.((node) => {
    const src = typeof node?.attrs?.src === 'string' ? node.attrs.src.trim() : '';
    if (src.toLowerCase().startsWith('http://')) {
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }
  });
  return counts;
}
