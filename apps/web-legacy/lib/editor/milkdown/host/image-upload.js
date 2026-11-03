export async function uploadAttachmentImage({ file, noteId, uploadAttachment }) {
  if (!(file instanceof File)) {
    throw new Error('Image upload requires a file');
  }
  if (!noteId) {
    throw new Error('Please select a note before uploading images');
  }
  if (typeof uploadAttachment !== 'function') {
    throw new Error('Image upload service is not available');
  }

  const contentBase64 = await fileToBase64(file);
  return uploadAttachment({
    noteId,
    fileName: file.name || 'image.png',
    mimeType: file.type || 'image/png',
    contentBase64
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read image file'));
        return;
      }

      const commaIndex = result.indexOf(',');
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}
