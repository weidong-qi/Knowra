import { sameKnowraText } from '@study-accelerator/shared/knowra-marks';

interface EvidenceHealthRecord {
  sourceType?: unknown;
  quoteText?: unknown;
}

interface EvidenceHealthAnnotation {
  quoteText?: unknown;
  anchorStatus?: unknown;
  lifecycleStatus?: unknown;
  status?: unknown;
}

interface EvidenceHealthNote {
  deleted?: unknown;
  rawMarkdown?: unknown;
}

interface EvidenceHealthVersion {
  content?: unknown;
}

/** 来源健康由当前依赖与不可变摘录推导；证据适用性和知识审核状态另行维护。 */
export function deriveEvidenceHealth(
  evidence: EvidenceHealthRecord,
  {
    annotation = null,
    note = null,
    version = null
  }: {
    annotation?: EvidenceHealthAnnotation | null;
    note?: EvidenceHealthNote | null;
    version?: EvidenceHealthVersion | null;
  } = {}
): 'valid' | 'stale' | 'invalid' | 'insufficient' {
  let status: 'valid' | 'stale' | 'invalid' | 'insufficient' = 'valid';
  if (annotation?.anchorStatus === 'missing') status = 'insufficient';
  else if (
    annotation?.anchorStatus === 'needsReview' ||
    annotation?.status === 'stale' ||
    (annotation && String(evidence.quoteText ?? '').trim() !== String(annotation.quoteText ?? '').trim())
  )
    status = 'stale';

  if (note?.deleted || (annotation?.lifecycleStatus === 'deleted' && !version)) return 'invalid';
  if (evidence.sourceType === 'noteVersion' && version && note && !sameKnowraText(version.content, note.rawMarkdown))
    return 'stale';
  return status;
}
