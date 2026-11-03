export function splitAttachmentFileName(fileName, fallbackExtension = '.png') {
  const normalizedValue = String(fileName ?? '').trim();
  if (!normalizedValue) {
    return {
      stem: '',
      extension: fallbackExtension
    };
  }

  const lastDotIndex = normalizedValue.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === normalizedValue.length - 1) {
    return {
      stem: normalizedValue,
      extension: fallbackExtension
    };
  }

  return {
    stem: normalizedValue.slice(0, lastDotIndex),
    extension: normalizedValue.slice(lastDotIndex)
  };
}

export function buildAttachmentFileName({ draft, extension, fallbackExtension = '.png' } = {}) {
  const normalizedExtension = normalizeAttachmentExtension(extension, fallbackExtension);
  const normalizedDraft = normalizeAttachmentDraft(draft, normalizedExtension);

  return `${normalizedDraft}${normalizedExtension}`;
}

function normalizeAttachmentDraft(draft, extension) {
  const trimmedDraft = String(draft ?? '').trim();
  if (!trimmedDraft) {
    return 'image';
  }

  if (extension && trimmedDraft.toLowerCase().endsWith(extension.toLowerCase())) {
    return trimmedDraft.slice(0, -extension.length).trim() || 'image';
  }

  return trimmedDraft;
}

function normalizeAttachmentExtension(extension, fallbackExtension) {
  const trimmedExtension = String(extension ?? '').trim();
  if (!trimmedExtension) {
    return fallbackExtension;
  }

  return trimmedExtension.startsWith('.') ? trimmedExtension : `.${trimmedExtension}`;
}
