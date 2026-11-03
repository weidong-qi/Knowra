import { createContext, useContext, useEffect, useRef, useState, type DragEvent, type PropsWithChildren } from 'react';
import { useAppStore } from '../../store/AppStoreProvider';
import { canMoveEntry, type DraggableEntry } from './entryMove';
import styles from './EntryDragDrop.module.css';
import { IconButton } from '../../components/ui';
import { CloseIcon } from '../../components/icons/knowra';

const ENTRY_DRAG_TYPE = 'application/x-knowra-entry';
const EXPAND_DELAY_MS = 650;

interface EntryDragDropContextValue {
  dragging: DraggableEntry | null;
  start(event: DragEvent<HTMLElement>, entry: DraggableEntry): void;
  end(): void;
  isInternal(event: DragEvent<HTMLElement>): boolean;
  canDrop(destinationId: string | null): boolean;
  drop(event: DragEvent<HTMLElement>, destinationId: string | null): Promise<void>;
}

const EntryDragDropContext = createContext<EntryDragDropContextValue | null>(null);

export function EntryDragDropProvider({ children }: PropsWithChildren) {
  const folders = useAppStore((state) => state.serverData.foldersById);
  const notes = useAppStore((state) => state.serverData.notes);
  const canWrite = useAppStore((state) => state.canWriteWorkspace());
  const moveEntry = useAppStore((state) => state.moveEntry);
  const [dragging, setDragging] = useState<DraggableEntry | null>(null);
  const [moveError, setMoveError] = useState('');
  const draggingRef = useRef<DraggableEntry | null>(null);
  const movingRef = useRef(false);

  function start(event: DragEvent<HTMLElement>, entry: DraggableEntry) {
    if (!canWrite || (entry.kind === 'folder'
      ? !folders[entry.id]
      : !notes.some((note) => note.id === entry.id && !note.deleted))) {
      event.preventDefault();
      return;
    }
    draggingRef.current = entry;
    setDragging(entry);
    setMoveError('');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(ENTRY_DRAG_TYPE, `${entry.kind}:${entry.id}`);
  }

  function end() {
    draggingRef.current = null;
    setDragging(null);
  }

  function isInternal(event: DragEvent<HTMLElement>) {
    return Boolean(draggingRef.current && Array.from(event.dataTransfer.types).includes(ENTRY_DRAG_TYPE));
  }

  function canDrop(destinationId: string | null) {
    const entry = draggingRef.current;
    return Boolean(entry && !movingRef.current && canMoveEntry(entry, destinationId, folders, notes, canWrite));
  }

  async function drop(event: DragEvent<HTMLElement>, destinationId: string | null) {
    const entry = draggingRef.current;
    if (!entry || event.dataTransfer.getData(ENTRY_DRAG_TYPE) !== `${entry.kind}:${entry.id}` || !canDrop(destinationId)) return;
    movingRef.current = true;
    end();
    try {
      await moveEntry(entry.kind, entry.id, destinationId);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : '目录移动失败，请重试');
    } finally {
      movingRef.current = false;
    }
  }

  return <EntryDragDropContext.Provider value={{ dragging, start, end, isInternal, canDrop, drop }}>
    {children}
    {moveError ? <div className={styles.moveError} role="alert">
      <span>移动失败：{moveError}</span>
      <IconButton aria-label="关闭移动错误提示" onClick={() => setMoveError('')}><CloseIcon size={16} /></IconButton>
    </div> : null}
  </EntryDragDropContext.Provider>;
}

export function useEntryDragDrop() {
  return useContext(EntryDragDropContext);
}

export function useEntryDropTarget(destinationId: string | null | undefined, onHover?: () => void) {
  const dragDrop = useEntryDragDrop();
  const [isOver, setIsOver] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const expandedDuringHover = useRef(false);

  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
  }, []);

  useEffect(() => {
    if (!dragDrop?.dragging) clearHover();
  }, [dragDrop?.dragging]);

  function clearHover() {
    setIsOver(false);
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    expandedDuringHover.current = false;
  }

  function accepts(event: DragEvent<HTMLElement>) {
    return destinationId !== undefined && dragDrop?.isInternal(event);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const valid = dragDrop!.canDrop(destinationId!);
    event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    setIsOver(valid);
    scrollEntryContainer(event);
    if (valid && onHover && hoverTimer.current === null && !expandedDuringHover.current) {
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = null;
        expandedDuringHover.current = true;
        onHover();
      }, EXPAND_DELAY_MS);
    }
    if (!valid && hoverTimer.current !== null) clearHover();
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const next = event.relatedTarget instanceof Node
      ? event.relatedTarget
      : document.elementFromPoint?.(event.clientX, event.clientY);
    if (next && event.currentTarget.contains(next)) return;
    clearHover();
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    clearHover();
    void dragDrop!.drop(event, destinationId!);
  }

  return {
    isOver,
    clear: clearHover,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop
  };
}

export function scrollEntryContainer(event: DragEvent<HTMLElement>) {
  const container = event.currentTarget.closest<HTMLElement>('[data-entry-scroll]');
  if (!container) return;
  const bounds = container.getBoundingClientRect();
  const edge = 36;
  if (event.clientY < bounds.top + edge) container.scrollTop -= 12;
  else if (event.clientY > bounds.bottom - edge) container.scrollTop += 12;
}
