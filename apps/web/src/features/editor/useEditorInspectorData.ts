import { useEffect, useRef, useState } from 'react';
import type { Annotation, Attachment, Note } from '@study-accelerator/web-core';

export function useEditorInspectorData({
  noteId,
  refreshKey,
  inspectorOpen,
  onListAttachments,
  onGetLinkedNotes,
  onListAnnotations,
  onError
}: {
  noteId?: string;
  refreshKey?: string;
  inspectorOpen: boolean;
  onListAttachments(noteId: string): Promise<Attachment[]>;
  onGetLinkedNotes(noteId: string): Promise<Note[]>;
  onListAnnotations(noteId: string): Promise<Annotation[]>;
  onError(message: string): void;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [linkedNotes, setLinkedNotes] = useState<Note[]>([]);
  const [linkedNotesLoading, setLinkedNotesLoading] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationsReadyNote, setAnnotationsReadyNote] = useState<string | undefined>();
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  const annotationRequestRef = useRef(0);
  const annotationNoteRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setAttachments([]);
    if (!noteId || !inspectorOpen) {
      setAttachmentsLoading(false);
      return () => {
        active = false;
      };
    }
    setAttachmentsLoading(true);
    void onListAttachments(noteId)
      .then(items => {
        if (active) setAttachments(items);
      })
      .catch(error => {
        if (active) onError(error instanceof Error ? error.message : '附件加载失败');
      })
      .finally(() => {
        if (active) setAttachmentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inspectorOpen, noteId, onError, onListAttachments]);

  useEffect(() => {
    const requestId = ++annotationRequestRef.current;
    let active = true;
    if (annotationNoteRef.current !== noteId) {
      setAnnotations([]);
      setFocusedAnnotationId(null);
      annotationNoteRef.current = noteId;
    }
    if (!noteId) {
      setAnnotationsLoading(false);
      return () => {
        active = false;
      };
    }
    setAnnotationsReadyNote(undefined);
    setAnnotationsLoading(true);
    void onListAnnotations(noteId)
      .then(items => {
        if (active && requestId === annotationRequestRef.current) {
          setAnnotations(items);
          setAnnotationsReadyNote(noteId);
        }
      })
      .catch(error => {
        if (active && requestId === annotationRequestRef.current)
          onError(error instanceof Error ? error.message : '正文标注加载失败');
      })
      .finally(() => {
        if (active && requestId === annotationRequestRef.current) setAnnotationsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [noteId, refreshKey, onError, onListAnnotations]);

  useEffect(() => {
    let active = true;
    setLinkedNotes([]);
    if (!noteId || !inspectorOpen) {
      setLinkedNotesLoading(false);
      return () => {
        active = false;
      };
    }
    setLinkedNotesLoading(true);
    void onGetLinkedNotes(noteId)
      .then(items => {
        if (active) setLinkedNotes(items);
      })
      .catch(error => {
        if (active) onError(error instanceof Error ? error.message : '关联链接加载失败');
      })
      .finally(() => {
        if (active) setLinkedNotesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inspectorOpen, noteId, onError, onGetLinkedNotes]);

  return {
    attachments,
    setAttachments,
    attachmentsLoading,
    linkedNotes,
    linkedNotesLoading,
    annotations,
    setAnnotations,
    annotationsLoading,
    annotationsReady: Boolean(noteId && annotationsReadyNote === noteId && !annotationsLoading),
    focusedAnnotationId,
    setFocusedAnnotationId
  };
}
