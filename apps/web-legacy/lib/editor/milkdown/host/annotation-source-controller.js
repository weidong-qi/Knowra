import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { annotationHighlightPluginKey, resolveAnnotationRange } from '../plugins/annotation-highlight-plugin.js';
export async function setAnnotations(host, annotations = []) { await host.ready; const view = host.editor.ctx.get(editorViewCtx); view.dispatch(view.state.tr.setMeta(annotationHighlightPluginKey, { annotations }).setMeta('addToHistory', false)); }
export async function selectAnnotation(host, annotationId) { await host.ready; const view = host.editor.ctx.get(editorViewCtx); const item = annotationHighlightPluginKey.getState(view.state)?.annotations.find((annotation) => annotation.id === annotationId); const range = item && resolveAnnotationRange(view.state.doc, item); if (!range) return false; view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)).scrollIntoView()); view.focus(); return true; }
