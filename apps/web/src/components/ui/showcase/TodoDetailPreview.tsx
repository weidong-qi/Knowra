import { useState } from 'react';
import {
  BellIcon,
  CalendarIcon,
  ClockIcon,
  CloseIcon,
  MoreHorizontalIcon,
  NodesIcon,
  StarIcon,
  TargetIcon
} from '../../icons/knowra';
import { Badge } from '../status';
import { Button, IconButton, SegmentedButton, SegmentedControl } from '../button';
import { GroupedList, GroupedRow, GroupedSubRow } from '../collection';
import { DatePicker, Select, Switch, TextAreaField, TextField } from '../input';
import { formatDateLabel } from '../input/DatePicker';
import styles from './TodoDetailPreview.module.css';

const presetOptions = [
  { id: 'branch', label: '支线任务' },
  { id: 'mainline', label: '主线任务' },
  { id: 'overdue', label: '暂停 / 逾期' }
] as const;
type PreviewPresetId = (typeof presetOptions)[number]['id'];
type ExpandableRowId = 'planned' | 'due' | 'reminder';

interface PreviewState {
  kindLabel: '支线' | '主线';
  status: 'active' | 'paused' | 'done';
  starred: boolean;
  path?: string;
  title: string;
  note: string;
  goal?: string;
  plannedEnabled: boolean;
  plannedDate: string | null;
  dueEnabled: boolean;
  dueDate: string | null;
  reminderEnabled: boolean;
  reminderTime: string;
  parentLine: string;
  priority: string;
  progress?: { done: number; total: number; nextStep: string };
  warning?: string;
}

const TODAY = '2026-11-21';

const PRESETS: Record<PreviewPresetId, PreviewState> = {
  branch: {
    kindLabel: '支线',
    status: 'active',
    starred: false,
    path: '英语能力提升 › 每日词汇',
    title: '测试3',
    note: '',
    plannedEnabled: true,
    plannedDate: '2026-11-21',
    dueEnabled: false,
    dueDate: null,
    reminderEnabled: false,
    reminderTime: '22:00',
    parentLine: 'english',
    priority: 'medium'
  },
  mainline: {
    kindLabel: '主线',
    status: 'active',
    starred: true,
    title: 'Knowra 待办侧栏视觉改版',
    note: '参考 macOS 提醒事项的分组圆角卡片排版，减少通栏分割线。',
    goal: '完成预览页定稿后，再将样式与交互迁移到 TodoDetailPanel。',
    plannedEnabled: true,
    plannedDate: '2026-11-21',
    dueEnabled: true,
    dueDate: '2026-11-25',
    reminderEnabled: true,
    reminderTime: '09:00',
    parentLine: 'none',
    priority: 'high',
    progress: { done: 3, total: 5, nextStep: '确认日期与提醒行交互' }
  },
  overdue: {
    kindLabel: '支线',
    status: 'paused',
    starred: false,
    path: '后端重构 › 权限校验',
    title: '补充 API 权限集成测试',
    note: '等待测试环境数据库迁移完成后继续。',
    plannedEnabled: true,
    plannedDate: '2026-11-22',
    dueEnabled: true,
    dueDate: '2026-11-19',
    reminderEnabled: false,
    reminderTime: '14:00',
    parentLine: 'backend',
    priority: 'high',
    warning: '当前截止日期已逾期 2 天，建议调整截止日期或恢复后优先处理。'
  }
};

const REMINDER_TIME_OPTIONS = [
  { id: '09:00', label: '09:00' },
  { id: '12:00', label: '12:00' },
  { id: '14:00', label: '14:00' },
  { id: '18:00', label: '18:00' },
  { id: '22:00', label: '22:00' }
];

const PARENT_OPTIONS = [
  { id: 'none', label: '无（独立）' },
  { id: 'english', label: '英语能力提升' },
  { id: 'backend', label: '后端重构' }
];

const PRIORITY_OPTIONS = [
  { id: 'none', label: '无' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' }
];

function formatSlashDate(value: string | null) {
  return value ? value.replace(/-/g, '/') : '选择日期';
}

export function TodoDetailPreview() {
  const [preset, setPreset] = useState<PreviewPresetId>('branch');
  const [state, setState] = useState<PreviewState>(PRESETS.branch);
  const [expandedRow, setExpandedRow] = useState<ExpandableRowId | null>('planned');

  const selectPreset = (next: PreviewPresetId) => {
    setPreset(next);
    setState(PRESETS[next]);
    setExpandedRow(PRESETS[next].plannedEnabled ? 'planned' : null);
  };

  const toggleExpand = (rowId: ExpandableRowId, enabled: boolean) => {
    if (!enabled) return;
    setExpandedRow(prev => (prev === rowId ? null : rowId));
  };

  const statusText = state.status === 'done' ? '已完成' : state.status === 'paused' ? '已暂停' : '进行中';
  const statusTone = state.status === 'done' ? 'success' : state.status === 'paused' ? 'warning' : 'accent';
  const isOverdue = Boolean(state.dueEnabled && state.dueDate && state.dueDate < TODAY && state.status !== 'done');

  return (
    <main className={styles.page} aria-label="待办详情侧栏视觉预览">
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <a href="#/showcase" className={styles.backLink}>
            ← 组件库
          </a>
          <h1 className={styles.toolbarTitle}>待办详情侧栏 · 视觉预览（Mac 提醒事项风格）</h1>
        </div>
        <SegmentedControl aria-label="预览场景" density="compact">
          {presetOptions.map(({ id, label }) => (
            <SegmentedButton key={id} aria-pressed={preset === id} onPress={() => selectPreset(id)}>
              {label}
            </SegmentedButton>
          ))}
        </SegmentedControl>
      </header>

      <div className={styles.stage}>
        <div className={styles.workspaceMock}>
          <section className={styles.listMock} aria-label="模拟任务列表">
            <div className={styles.listMockHeader}>
              <h2>今天</h2>
              <span className={styles.listMockHint}>点击左侧切换示例，右侧日期行可点击展开调整</span>
            </div>
            <div className={styles.mockRows}>
              {presetOptions.map(({ id }) => (
                <button
                  key={id}
                  type="button"
                  className={`${styles.mockRow} ${preset === id ? styles.mockRowActive : ''}`}
                  onClick={() => selectPreset(id)}
                >
                  <span className={styles.mockDot} aria-hidden="true" />
                  <span>{PRESETS[id].title}</span>
                </button>
              ))}
            </div>
          </section>

          <aside className={styles.inspector} aria-label={`待办详情预览：${state.title}`}>
            <div className={styles.inspectorTop}>
              <header className={styles.inspectorHeader}>
                <Badge tone="neutral" hideDot>
                  {state.kindLabel}
                </Badge>
                <Badge tone={statusTone}>{statusText}</Badge>
                <span className={styles.headerActions}>
                  <IconButton
                    size={24}
                    aria-label={state.starred ? '取消星标' : '加星标'}
                    aria-pressed={state.starred}
                    onPress={() => setState(prev => ({ ...prev, starred: !prev.starred }))}
                  >
                    <StarIcon size={15} className={state.starred ? styles.starActive : undefined} />
                  </IconButton>
                  <IconButton size={24} aria-label="更多操作">
                    <MoreHorizontalIcon size={15} />
                  </IconButton>
                  <IconButton size={24} aria-label="关闭详情">
                    <CloseIcon size={16} />
                  </IconButton>
                </span>
              </header>

              {state.path ? <span className={styles.pathText}>{state.path}</span> : null}

              <div className={styles.titleBlock}>
                <TextField
                  label="名称"
                  hideLabel
                  appearance="bare"
                  className={styles.titleField}
                  value={state.title}
                  onChange={title => setState(prev => ({ ...prev, title }))}
                />
                <TextAreaField
                  label="备注"
                  presentation="inline"
                  placeholder="备注"
                  rows={2}
                  value={state.note}
                  onChange={note => setState(prev => ({ ...prev, note }))}
                />
              </div>
            </div>

            <div className={styles.inspectorBody}>
              <GroupedList title="日期与时间">
                <GroupedRow
                  icon={<CalendarIcon size={16} />}
                  label="日期"
                  description={
                    state.plannedEnabled && state.plannedDate ? formatDateLabel(state.plannedDate, TODAY) : undefined
                  }
                  onPress={state.plannedEnabled ? () => toggleExpand('planned', state.plannedEnabled) : undefined}
                  expanded={expandedRow === 'planned'}
                  control={
                    <Switch
                      className={styles.switchCompact}
                      isSelected={state.plannedEnabled}
                      onChange={plannedEnabled => {
                        setState(prev => ({
                          ...prev,
                          plannedEnabled,
                          plannedDate: plannedEnabled ? (prev.plannedDate ?? TODAY) : null
                        }));
                        setExpandedRow(plannedEnabled ? 'planned' : null);
                      }}
                    >
                      <span className={styles.srOnly}>启用计划日期</span>
                    </Switch>
                  }
                />
                {state.plannedEnabled && expandedRow === 'planned' ? (
                  <GroupedSubRow>
                    <DatePicker
                      label="计划日期"
                      value={state.plannedDate}
                      today={TODAY}
                      onChange={plannedDate => setState(prev => ({ ...prev, plannedDate }))}
                    >
                      {formatSlashDate(state.plannedDate)}
                    </DatePicker>
                  </GroupedSubRow>
                ) : null}

                <GroupedRow
                  icon={<ClockIcon size={16} />}
                  label="截止"
                  description={
                    state.dueEnabled && state.dueDate
                      ? `${formatDateLabel(state.dueDate, TODAY)}${isOverdue ? ' · 已逾期' : ''}`
                      : undefined
                  }
                  descriptionTone={isOverdue ? 'danger' : 'default'}
                  onPress={state.dueEnabled ? () => toggleExpand('due', state.dueEnabled) : undefined}
                  expanded={expandedRow === 'due'}
                  control={
                    <Switch
                      className={styles.switchCompact}
                      isSelected={state.dueEnabled}
                      onChange={dueEnabled => {
                        setState(prev => ({
                          ...prev,
                          dueEnabled,
                          dueDate: dueEnabled ? (prev.dueDate ?? TODAY) : null
                        }));
                        setExpandedRow(dueEnabled ? 'due' : null);
                      }}
                    >
                      <span className={styles.srOnly}>启用截止日期</span>
                    </Switch>
                  }
                />
                {state.dueEnabled && expandedRow === 'due' ? (
                  <GroupedSubRow>
                    <DatePicker
                      label="截止日期"
                      value={state.dueDate}
                      today={TODAY}
                      tone={isOverdue ? 'danger' : 'default'}
                      onChange={dueDate => setState(prev => ({ ...prev, dueDate }))}
                    >
                      {formatSlashDate(state.dueDate)}
                    </DatePicker>
                  </GroupedSubRow>
                ) : null}

                <GroupedRow
                  icon={<BellIcon size={16} />}
                  label="提醒"
                  description={state.reminderEnabled ? state.reminderTime : undefined}
                  onPress={state.reminderEnabled ? () => toggleExpand('reminder', state.reminderEnabled) : undefined}
                  expanded={expandedRow === 'reminder'}
                  control={
                    <Switch
                      className={styles.switchCompact}
                      isSelected={state.reminderEnabled}
                      onChange={reminderEnabled => {
                        setState(prev => ({ ...prev, reminderEnabled }));
                        setExpandedRow(reminderEnabled ? 'reminder' : null);
                      }}
                    >
                      <span className={styles.srOnly}>启用提醒</span>
                    </Switch>
                  }
                />
                {state.reminderEnabled && expandedRow === 'reminder' ? (
                  <GroupedSubRow>
                    <Select
                      label="提醒时间"
                      presentation="chip"
                      options={REMINDER_TIME_OPTIONS}
                      selectedKey={state.reminderTime}
                      onSelectionChange={key => setState(prev => ({ ...prev, reminderTime: String(key) }))}
                    />
                  </GroupedSubRow>
                ) : null}
              </GroupedList>

              <GroupedList title="组织">
                <GroupedRow
                  icon={<NodesIcon size={16} />}
                  label="所属主线"
                  control={
                    <Select
                      label="所属主线"
                      presentation="chip"
                      options={PARENT_OPTIONS}
                      selectedKey={state.parentLine}
                      onSelectionChange={key => setState(prev => ({ ...prev, parentLine: String(key) }))}
                    />
                  }
                />
                <GroupedRow
                  icon={<TargetIcon size={16} />}
                  label="优先级"
                  control={
                    <Select
                      label="优先级"
                      presentation="chip"
                      options={PRIORITY_OPTIONS}
                      selectedKey={state.priority}
                      onSelectionChange={key => setState(prev => ({ ...prev, priority: String(key) }))}
                    />
                  }
                />
              </GroupedList>

              {state.progress ? (
                <GroupedList title="进展与目标">
                  <div className={styles.progressCardBody}>
                    <div className={styles.progressMeta}>
                      <span>直接下级进展</span>
                      <strong>
                        {state.progress.done} / {state.progress.total} 完成
                      </strong>
                    </div>
                    <div className={styles.progressTrack} aria-hidden="true">
                      <div
                        className={styles.progressBar}
                        style={{ width: `${Math.round((state.progress.done / state.progress.total) * 100)}%` }}
                      />
                    </div>
                    <div className={styles.nextStepBox}>
                      <span>下一步</span>
                      <strong>{state.progress.nextStep}</strong>
                    </div>
                  </div>
                </GroupedList>
              ) : null}

              {state.kindLabel === '主线' ? (
                <GroupedList title="目标与完成标准">
                  <TextAreaField
                    label="目标与完成标准"
                    presentation="inset"
                    placeholder="这条主线做到什么程度算完成？"
                    rows={3}
                    value={state.goal ?? ''}
                    onChange={goal => setState(prev => ({ ...prev, goal }))}
                  />
                </GroupedList>
              ) : null}

              {state.warning ? <div className={styles.warningBanner}>{state.warning}</div> : null}
            </div>

            <footer className={styles.inspectorFooter}>
              {state.status !== 'done' ? (
                <Button
                  size="compact"
                  variant="ghost"
                  onPress={() =>
                    setState(prev => ({
                      ...prev,
                      status: prev.status === 'paused' ? 'active' : 'paused'
                    }))
                  }
                >
                  {state.status === 'paused' ? '恢复' : '暂停'}
                </Button>
              ) : null}
              <Button
                size="compact"
                variant={state.status === 'done' ? 'default' : 'primary'}
                onPress={() =>
                  setState(prev => ({
                    ...prev,
                    status: prev.status === 'done' ? 'active' : 'done'
                  }))
                }
              >
                {state.status === 'done' ? '重新打开' : '标为完成'}
              </Button>
            </footer>
          </aside>
        </div>
      </div>
    </main>
  );
}
