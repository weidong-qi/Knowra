import type { Annotation } from '@study-accelerator/web-core';

export const KIND_OPTIONS = [{ id: 'important', label: '重点' }, { id: 'question', label: '疑问' }, { id: 'supplement', label: '补充' }, { id: 'pitfall', label: '易错' }, { id: 'temporary', label: '临时笔记' }];
export const IMPORTANCE_OPTIONS = [{ id: 'normal', label: '普通' }, { id: 'important', label: '重点' }, { id: 'core', label: '核心' }];
export const STATUS_FILTERS = [{ id: 'active', label: '原文可定位' }, { id: 'needsReview', label: '原文待核对' }, { id: 'all', label: '全部原文状态' }];
export function scopeLabel(scope?: Annotation['scopeType']) { return scope === 'list' ? '列表项' : scope === 'blocks' ? '内容块' : scope === 'section' ? '标题章节' : '文字选区'; }
