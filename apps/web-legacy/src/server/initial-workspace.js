export async function loadInitialWorkspaceSnapshot({ getApiOrigin }) {
  try {
    const spacesPayload = await fetchApiJson('/api/knowledge/spaces', { getApiOrigin });
    const spaces = Array.isArray(spacesPayload.data) ? spacesPayload.data : [];
    const space = spaces[0] ?? await ensureDefaultSpace({ getApiOrigin });

    if (!space?.id) {
      return null;
    }

    const [folderTreePayload, notesPayload, tagsPayload] = await Promise.all([
      fetchApiJson(`/api/knowledge/folders/tree?spaceId=${encodeURIComponent(space.id)}`, { getApiOrigin }),
      fetchApiJson(`/api/knowledge/notes?spaceId=${encodeURIComponent(space.id)}&summaryOnly=true`, { getApiOrigin }),
      fetchApiJson(`/api/knowledge/tags?spaceId=${encodeURIComponent(space.id)}`, { getApiOrigin })
    ]);

    return {
      spaces: spaces.length ? spaces : [space],
      currentSpaceId: space.id,
      folderTree: Array.isArray(folderTreePayload.data) ? folderTreePayload.data : [],
      allNotes: Array.isArray(notesPayload.data) ? notesPayload.data : [],
      tags: Array.isArray(tagsPayload.data) ? tagsPayload.data : [],
      openFolders: {},
      selectedFolderId: null,
      selectedNoteId: null
    };
  } catch (error) {
    return null;
  }
}

async function ensureDefaultSpace({ getApiOrigin }) {
  const payload = await fetchApiJson('/api/knowledge/spaces/default', {
    getApiOrigin,
    method: 'POST',
    body: JSON.stringify({})
  });
  return payload.data ?? null;
}

async function fetchApiJson(pathname, options = {}) {
  const response = await fetch(new URL(pathname, options.getApiOrigin()), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    body: options.body,
    signal: AbortSignal.timeout(1800)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}
