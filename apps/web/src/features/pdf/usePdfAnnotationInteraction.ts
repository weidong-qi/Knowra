import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FloatingPoint } from '../../components/ui/overlay/floatingPanelGeometry';
import { initialCommentPoint } from './pdfAnnotationGeometry';

export type AnnotationPoint = FloatingPoint & { id: string };
export type AnnotationPicker = FloatingPoint & {
  ids: string[];
  selectedBefore: string | null;
  intent: 'actions' | 'edit';
};

/** 选中、临时操作与批注窗口相互独立；坐标只在本次阅读中记忆。 */
export function usePdfAnnotationInteraction(noteId: string, containerRef: RefObject<HTMLDivElement | null>) {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [annotationAction, setAnnotationAction] = useState<AnnotationPoint | null>(null);
  const [annotationPicker, setAnnotationPicker] = useState<AnnotationPicker | null>(null);
  const [commentEditor, setCommentEditor] = useState<(AnnotationPoint & { focusRequest: number }) | null>(null);
  const positions = useRef(new Map<string, FloatingPoint>());
  const focusSequence = useRef(0);
  useEffect(() => {
    positions.current.clear();
    setSelected(null);
    setSelectionRevision(0);
    setAnnotationAction(null);
    setAnnotationPicker(null);
    setCommentEditor(null);
  }, [noteId]);
  const selectFromPage = useCallback((id: string) => {
    setSelected(id);
    setSelectionRevision(value => value + 1);
  }, []);
  const openComment = useCallback(
    (id: string, focus = true, pointer?: FloatingPoint) => {
      const point = positions.current.get(id) ?? initialCommentPoint(containerRef.current, id, pointer);
      positions.current.set(id, point);
      setCommentEditor({ id, ...point, focusRequest: focus ? ++focusSequence.current : 0 });
      setSelected(id);
      setAnnotationAction(null);
      setAnnotationPicker(null);
    },
    [containerRef]
  );
  const moveComment = useCallback((point: FloatingPoint) => {
    setCommentEditor(current => {
      if (!current || (current.x === point.x && current.y === point.y)) return current;
      positions.current.set(current.id, point);
      return { ...current, ...point };
    });
  }, []);
  const toggleActions = useCallback((id: string, point: FloatingPoint) => {
    setSelected(id);
    setSelectionRevision(value => value + 1);
    setAnnotationPicker(null);
    setAnnotationAction(current => (current?.id === id ? null : { id, ...point }));
  }, []);
  return {
    selected,
    setSelected,
    selectionRevision,
    selectFromPage,
    annotationAction,
    setAnnotationAction,
    annotationPicker,
    setAnnotationPicker,
    commentEditor,
    setCommentEditor,
    openComment,
    moveComment,
    toggleActions
  };
}
