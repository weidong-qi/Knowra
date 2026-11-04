import { serializerCtx } from '@milkdown/kit/core';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { IDENTITY_META } from './editorBlockIdentity';
import {
  hasPastedKnowraMarks,
  knowraClipboardIntent,
  KNOWRA_CLIPBOARD_CUT,
  rememberNativeKnowraClipboard
} from './editorKnowraClipboard';
import { listItemAt } from './editorListAnnotations';

interface DocumentEventsState {
  /** 块操作菜单打开时记下的位置；正文变化后随映射移动，块被删或列表层级变了则作废。 */
  actionTarget: { pos: number; listDepth?: number; invalid?: boolean } | null;
  /** 正文修订号；块身份维护和不改变 Markdown 的非历史事务不递增，不触发保存。 */
  contentRevision: number;
}

const documentEventsKey = new PluginKey<DocumentEventsState>('KNOWRA_V4_DOCUMENT_EVENTS');

/**
 * 编辑器正文事件：每个改变 Markdown 的事务同步发布整篇正文（防抖监听可能把旧文档回放到新草稿上），
 * 同时记录选区、块菜单目标，处理点击重点高亮与带重点标记的剪切/复制。
 */
export function createDocumentEventsBehavior(
  onSelectAnnotation: (annotationIds: string[]) => void,
  onDocumentChange: (markdown: string) => void,
  onSelectionChange: (selection: { from: number; to: number }) => void
) {
  return $prose(
    ctx =>
      new Plugin<DocumentEventsState>({
        key: documentEventsKey,
        state: {
          init: () => ({ actionTarget: null, contentRevision: 0 }),
          apply(transaction, previous) {
            const meta = transaction.getMeta(documentEventsKey) as
              Pick<DocumentEventsState, 'actionTarget'> | undefined;
            let actionTarget = meta ? meta.actionTarget : previous.actionTarget;
            if (!meta && !transaction.docChanged) return previous;
            if (transaction.docChanged && actionTarget) {
              const mapped = transaction.mapping.mapResult(actionTarget.pos, 1);
              const item = listItemAt(transaction.doc, mapped.pos);
              actionTarget = {
                ...actionTarget,
                pos: mapped.pos,
                invalid:
                  actionTarget.invalid ||
                  mapped.deletedAcross ||
                  (actionTarget.listDepth !== undefined && item?.depth !== actionTarget.listDepth)
              };
            }
            // 非历史维护事务（如标题 DOM ID）不改变正文；真正改写 Markdown 的非历史事务仍须保存。
            const contentChanged =
              transaction.docChanged &&
              !transaction.getMeta(IDENTITY_META) &&
              (transaction.getMeta('addToHistory') !== false ||
                ctx.get(serializerCtx)(transaction.before) !== ctx.get(serializerCtx)(transaction.doc));
            return { actionTarget, contentRevision: previous.contentRevision + (contentChanged ? 1 : 0) };
          }
        },
        view: () => ({
          update(view, previousState) {
            onSelectionChange({ from: view.state.selection.from, to: view.state.selection.to });
            if (
              documentEventsKey.getState(view.state)?.contentRevision !==
              documentEventsKey.getState(previousState)?.contentRevision
            )
              onDocumentChange(ctx.get(serializerCtx)(view.state.doc));
          }
        }),
        props: {
          handleDOMEvents: {
            cut(view, event) {
              if (!event.clipboardData || view.state.selection.empty) return false;
              const slice = view.state.selection.content();
              const serialized = view.serializeForClipboard(slice);
              const html = Array.from(serialized.dom.childNodes, node =>
                new XMLSerializer().serializeToString(node)
              ).join('');
              rememberNativeKnowraClipboard(slice, serialized.text);
              event.clipboardData.clearData();
              event.clipboardData.setData('text/html', html);
              event.clipboardData.setData('text/plain', serialized.text);
              event.preventDefault();
              view.dispatch(
                view.state.tr
                  .deleteSelection()
                  .setMeta('uiEvent', 'cut')
                  .setMeta(
                    KNOWRA_CLIPBOARD_CUT,
                    hasPastedKnowraMarks(slice) ? knowraClipboardIntent(serialized.text, slice) : null
                  )
                  .scrollIntoView()
              );
              return true;
            },
            copy(view) {
              const slice = view.state.selection.content();
              rememberNativeKnowraClipboard(slice, view.serializeForClipboard(slice).text);
              return false;
            }
          },
          handleClick(_view, _position, event) {
            const target =
              event.target instanceof Element ? event.target.closest<HTMLElement>('[data-annotation-ids]') : null;
            if (!target?.dataset.annotationIds) return false;
            const annotationIds = JSON.parse(target.dataset.annotationIds) as string[];
            if (annotationIds.length === 0) return false;
            onSelectAnnotation(annotationIds);
            return true;
          }
        }
      })
  );
}

export function captureAnnotationActionTarget(view: EditorView, pos: number) {
  const list = listItemAt(view.state.doc, pos);
  view.dispatch(
    view.state.tr
      .setMeta(documentEventsKey, { actionTarget: { pos, listDepth: list?.depth } })
      .setMeta('addToHistory', false)
  );
}

export function currentAnnotationActionTarget(view: EditorView) {
  const target = documentEventsKey.getState(view.state)?.actionTarget;
  return target && !target.invalid ? target.pos : null;
}
