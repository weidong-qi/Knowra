/** 固定文件名，不使用不可信报告字段；调用前由界面明确告知包含原文。 */
export function downloadReview(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'knowra-unapproved-review-draft.json';
  try { document.body.append(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
