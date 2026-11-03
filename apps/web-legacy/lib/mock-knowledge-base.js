export const knowledgeBaseSeed = {
  spaces: [
    {
      id: 'space-personal',
      name: '个人知识库',
      description: '日常记录、整理与复盘的主工作空间'
    }
  ],
  folders: [
    { id: 'folder-study-root', parentId: null, name: 'STUDY' },
    { id: 'folder-inbox', parentId: 'folder-study-root', name: 'Inbox' },
    { id: 'folder-study', parentId: 'folder-study-root', name: 'Study' },
    { id: 'folder-projects', parentId: 'folder-study-root', name: 'Projects' }
  ],
  tags: [
    { id: 'tag-architecture', name: 'architecture', color: '#3c68ff' },
    { id: 'tag-review', name: 'review', color: '#8b5cf6' },
    { id: 'tag-daily', name: 'daily', color: '#1f9d63' },
    { id: 'tag-import', name: 'import', color: '#d97706' }
  ],
  notes: [
    {
      id: 'note-ui-foundation',
      title: 'V1.1 UI Foundation',
      folderId: 'folder-projects',
      summary: 'Thin shell, bold workspace, and Typora-style reading flow.',
      sourceType: 'manual',
      favorite: true,
      updatedAt: '2026-06-03T09:12:00.000Z',
      wordCount: 912,
      status: 'draft',
      tagIds: ['tag-architecture', 'tag-review'],
      internalLinks: ['note-markdown-flow'],
      rawMarkdown: `# V1.1 UI Foundation

The interface should feel like a command center from the outside and a writing desk from the inside.

## Rules

- Keep the shell thin.
- Give the workspace the most space.
- Let the source editor expand only when needed.

> The reading surface should stay calm.`
    },
    {
      id: 'note-markdown-flow',
      title: 'Markdown Reading Flow',
      folderId: 'folder-study',
      summary: 'Preview-first interaction with inline source expansion.',
      sourceType: 'manual',
      favorite: false,
      updatedAt: '2026-06-02T22:18:00.000Z',
      wordCount: 642,
      status: 'active',
      tagIds: ['tag-daily'],
      internalLinks: ['note-ui-foundation'],
      rawMarkdown: `# Markdown Reading Flow

Use the preview as the default surface.

## Editing

1. Show rendered Markdown first.
2. Open the source editor beside the preview.
3. Keep formatting shortcuts close to the content.

\`\`\`md
# Heading

**Bold text**
\`\`\``
    },
    {
      id: 'note-project-log',
      title: 'Project Log',
      folderId: 'folder-projects',
      summary: 'Track implementation details and decisions.',
      sourceType: 'markdown-import',
      favorite: true,
      updatedAt: '2026-06-01T18:45:00.000Z',
      wordCount: 388,
      status: 'active',
      tagIds: ['tag-import'],
      internalLinks: ['note-ui-foundation'],
      rawMarkdown: `# Project Log

- Baseline shell completed
- Knowledge module placed in focus
- Need a reusable status bar action system`
    },
    {
      id: 'note-research',
      title: 'Reading Stack Notes',
      folderId: 'folder-study',
      summary: 'Ideas and links collected from reading.',
      sourceType: 'manual',
      favorite: false,
      updatedAt: '2026-06-01T12:40:00.000Z',
      wordCount: 244,
      status: 'archived',
      tagIds: ['tag-review'],
      internalLinks: [],
      rawMarkdown: `# Reading Stack Notes

Collect references, quotes, and extracted insights here.

- Paper links
- Summaries
- Open questions`
    },
    {
      id: 'note-course-pdf',
      title: 'Linear Algebra Handout.pdf',
      folderId: 'folder-study',
      summary: 'Imported PDF handout for quick review.',
      sourceType: 'pdf-import',
      favorite: false,
      updatedAt: '2026-06-01T08:15:00.000Z',
      wordCount: 0,
      status: 'active',
      tagIds: ['tag-import'],
      internalLinks: [],
      rawMarkdown: `# Linear Algebra Handout.pdf

Imported PDF material placeholder.`
    },
    {
      id: 'note-resource-deck',
      title: 'Architecture Deck.pptx',
      folderId: 'folder-projects',
      summary: 'Imported slide deck reference.',
      sourceType: 'imported-file',
      favorite: false,
      updatedAt: '2026-05-31T16:10:00.000Z',
      wordCount: 0,
      status: 'archived',
      tagIds: ['tag-import'],
      internalLinks: [],
      rawMarkdown: `# Architecture Deck.pptx

Imported presentation material placeholder.`
    }
  ],
  attachments: [
    { id: 'attach-1', noteId: 'note-ui-foundation', fileName: 'wireframe.png', mimeType: 'image/png' },
    { id: 'attach-2', noteId: 'note-project-log', fileName: 'brief.md', mimeType: 'text/markdown' }
  ]
};

export function getNoteById(noteId) {
  return knowledgeBaseSeed.notes.find((note) => note.id === noteId) ?? null;
}
