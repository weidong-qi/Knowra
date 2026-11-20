import { useMemo, useState } from 'react';
import type { Todo } from '@study-accelerator/web-core';
import { ClockIcon, PlusIcon, StarIcon } from '../../components/icons/knowra';
import { Button, DatePicker, Select, TextField } from '../../components/ui';
import { useTodoActions } from './TodoActions';
import { addDaysToDate, relativeDateLabel } from './todoPresentation';
import styles from './PersonalTodos.module.css';

/** 只填名称即可保存；主添加入口聚焦后展开日期、截止、主线归属与星标快捷芯片。 */
export function QuickAdd({
  parentId,
  kind,
  plannedDate,
  placeholder,
  depth = 0,
  compact = false,
  mainlines
}: {
  parentId: string | null;
  kind?: 'mainline' | 'sideline';
  plannedDate?: string | null;
  placeholder: string;
  depth?: number;
  compact?: boolean;
  /** 可选进行中主线列表；提供后允许在添加支线/今日任务时直接挂到某条主线下。 */
  mainlines?: Todo[];
}) {
  const actions = useTodoActions();
  const { today } = actions;
  const tomorrow = addDaysToDate(today, 1);

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draftPlan, setDraftPlan] = useState<string | null>(plannedDate ?? null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [starred, setStarred] = useState(false);
  const [targetParentId, setTargetParentId] = useState<string>(parentId ?? '');

  const showToolbar =
    !compact && (expanded || Boolean(title.trim()) || Boolean(dueDate) || starred || Boolean(targetParentId));
  const mainlineOptions = useMemo(
    () => [
      { id: '', label: '独立支线' },
      ...(mainlines ?? []).map(item => ({ id: item.id, label: `主线：${item.title}` }))
    ],
    [mainlines]
  );

  const resetDraft = () => {
    setTitle('');
    setDraftPlan(plannedDate ?? null);
    setDueDate(null);
    setStarred(false);
    setTargetParentId(parentId ?? '');
    setExpanded(false);
  };

  const submit = async () => {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    const resolvedParent = parentId ?? (targetParentId || null);
    const resolvedKind = resolvedParent ? undefined : kind;
    const created = await actions.create({
      parentId: resolvedParent,
      title: value,
      kind: resolvedKind,
      plannedDate: kind === 'mainline' ? undefined : draftPlan,
      ...(dueDate ? { dueDate } : {}),
      ...(starred ? { starred } : {})
    });
    setBusy(false);
    if (created) {
      setTitle('');
      setDueDate(null);
      setStarred(false);
    }
  };

  if (compact) {
    return (
      <div className={styles.quickAddCompact} style={{ '--depth': depth } as React.CSSProperties} role="listitem">
        <PlusIcon size={14} className={styles.quickAddIcon} aria-hidden="true" />
        <TextField
          label={placeholder}
          hideLabel
          appearance="bare"
          placeholder={`${placeholder}，回车保存`}
          value={title}
          onChange={setTitle}
          isDisabled={busy}
          maxLength={200}
          className={styles.quickAddField}
          onKeyDown={event => {
            if (event.key === 'Enter') void submit();
            if (event.key === 'Escape') setTitle('');
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.quickAddWrap} data-expanded={showToolbar || undefined} onFocus={() => setExpanded(true)}>
      <div className={styles.quickAdd}>
        <PlusIcon size={16} className={styles.quickAddIcon} aria-hidden="true" />
        <TextField
          label={placeholder}
          hideLabel
          appearance="bare"
          placeholder={showToolbar ? `${placeholder}，回车保存` : placeholder}
          value={title}
          onChange={setTitle}
          isDisabled={busy}
          maxLength={200}
          className={styles.quickAddField}
          onKeyDown={event => {
            if (event.key === 'Enter') void submit();
            if (event.key === 'Escape') resetDraft();
          }}
        />
        {showToolbar ? (
          <div className={styles.quickAddSubmit}>
            <Button size="compact" variant="ghost" onPress={resetDraft}>
              收起
            </Button>
            <Button size="compact" variant="primary" isDisabled={!title.trim() || busy} onPress={() => void submit()}>
              添加
            </Button>
          </div>
        ) : null}
      </div>

      {showToolbar ? (
        <div className={styles.quickAddChips}>
          {kind !== 'mainline' ? (
            <>
              <Button
                size="chip"
                variant="ghost"
                className={styles.quickChip}
                data-active={draftPlan === today || undefined}
                aria-pressed={draftPlan === today}
                onPress={() => setDraftPlan(draftPlan === today ? null : today)}
              >
                今天
              </Button>
              <Button
                size="chip"
                variant="ghost"
                className={styles.quickChip}
                data-active={draftPlan === tomorrow || undefined}
                aria-pressed={draftPlan === tomorrow}
                onPress={() => setDraftPlan(draftPlan === tomorrow ? null : tomorrow)}
              >
                明天
              </Button>
              <DatePicker
                label="截止日期"
                value={dueDate}
                today={today}
                placeholder="截止日期"
                icon={<ClockIcon size={12} />}
                className={styles.quickChipDate}
                onChange={setDueDate}
              >
                {dueDate ? `截止 ${relativeDateLabel(dueDate, today)}` : undefined}
              </DatePicker>
              {parentId === null && mainlines && mainlines.length > 0 ? (
                <Select
                  label="归属"
                  presentation="toolbar"
                  options={mainlineOptions}
                  selectedKey={targetParentId}
                  onSelectionChange={key => setTargetParentId(String(key ?? ''))}
                  className={styles.quickChipSelect}
                />
              ) : null}
            </>
          ) : null}
          <Button
            size="chip"
            variant="ghost"
            className={styles.quickChip}
            data-active={starred || undefined}
            aria-pressed={starred}
            onPress={() => setStarred(prev => !prev)}
          >
            <StarIcon size={12} className={starred ? styles.starMark : undefined} />
            星标
          </Button>
        </div>
      ) : null}
    </div>
  );
}
